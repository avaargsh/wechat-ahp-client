import { createHash } from 'node:crypto';
import {
  ActionType,
  ResponsePartKind,
  ToolCallCancellationReason,
  ToolCallConfirmationReason,
  ToolCallStatus,
  chatReducer,
  type ChatState,
  type SessionState,
  type StateAction,
  type StringOrMarkdown,
} from '@microsoft/agent-host-protocol';
import type { Subscription, SubscriptionEvent } from '@microsoft/agent-host-protocol/client';
import type { AttentionProjection, ResolveDecision } from '@wechat-ahp/protocol';
import { discoverHosts, resolveHost } from './discovery.js';
import { HostConnection } from './connection.js';
import { reconcilePendingAttention, refreshPendingApproval } from './pending-attention.js';

export interface AhpBinding {
  hostId: string;
  sessionUri: string;
  chatUri: string;
  label: string;
}

export interface AhpAdapterOptions {
  machineId: string;
  onAttention(attention: AttentionProjection): void;
  onResolved(attention: AttentionProjection): void;
  log(message: string): void;
}

interface PendingTool {
  attention: AttentionProjection;
  turnId: string;
  toolCallId: string;
}

function text(value: StringOrMarkdown | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.markdown;
}

function makeAttentionId(binding: AhpBinding, turnId: string, toolCallId: string): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([binding.hostId, binding.chatUri, turnId, toolCallId]))
    .digest('hex')
    .slice(0, 24);
  return `att_${digest}`;
}

export class AhpAdapter {
  private connection?: HostConnection;
  private subscription?: Subscription;
  private state?: ChatState;
  private sequence = 0;
  private binding?: AhpBinding;
  private consumeTask?: Promise<void>;
  private readonly pending = new Map<string, PendingTool>();

  constructor(private readonly options: AhpAdapterOptions) {}

  static async selectBinding(): Promise<AhpBinding[]> {
    const choices: AhpBinding[] = [];

    for (const host of await discoverHosts()) {
      let connection: HostConnection | undefined;
      try {
        connection = await HostConnection.connect(host);
        let cursor: string | undefined;

        for (let page = 0; page < 10; page++) {
          const result = await connection.listSessions(cursor);

          for (const summary of result.items) {
            let session: SessionState;
            try {
              session = await connection.session(summary.resource);
            } catch {
              continue;
            }

            for (const chat of session.chats) {
              if (chat.interactivity && chat.interactivity !== 'full') continue;
              choices.push({
                hostId: host.id,
                sessionUri: summary.resource,
                chatUri: chat.resource,
                label: `${host.product} · ${summary.title || 'Untitled'} · ${chat.title || 'Chat'}`,
              });
            }
          }

          if (!result.nextCursor) break;
          cursor = result.nextCursor;
        }
      } finally {
        await connection?.close().catch(() => undefined);
      }
    }

    return choices;
  }

  async start(binding: AhpBinding): Promise<void> {
    await this.stop();

    const host = await resolveHost(binding.hostId);
    const connection = await HostConnection.connect(host);
    this.connection = connection;

    const { result, subscription } = await connection.client.subscribe(binding.chatUri, {
      view: { turns: 64 },
      delivery: { maxLatencyMs: 0 },
    });

    const snapshot = result.snapshot;
    if (!snapshot || !snapshot.state || !('turns' in snapshot.state)) {
      await connection.close();
      this.connection = undefined;
      throw new Error('Selected AHP chat did not return a chat snapshot.');
    }

    this.subscription = subscription;
    this.binding = binding;
    this.state = snapshot.state as ChatState;
    this.sequence = snapshot.fromSeq;
    this.syncPending(binding);
    this.consumeTask = this.consume(binding, subscription);
    this.options.log(`AHP bound: ${binding.label}`);
  }

  async stop(): Promise<void> {
    const subscription = this.subscription;
    this.subscription = undefined;

    if (subscription) await subscription.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);

    this.connection = undefined;
    await this.consumeTask?.catch(() => undefined);
    this.consumeTask = undefined;
    this.state = undefined;
    this.binding = undefined;
    this.pending.clear();
  }

  listPending(): AttentionProjection[] {
    return [...this.pending.values()].map(value => value.attention);
  }

  async resolve(
    attentionId: string,
    decision: ResolveDecision,
    expectedVersion: number,
  ): Promise<AttentionProjection> {
    const pending = this.pending.get(attentionId);
    const connection = this.connection;
    const binding = this.binding;

    if (!pending || !connection || !binding) {
      throw Object.assign(new Error('approval is no longer pending'), {
        code: 'not_pending' as const,
      });
    }

    // AHP's confirmation action has no content/version CAS. Refresh the live
    // Host snapshot immediately before dispatch to narrow the read/execute race.
    // This is fail-closed on refresh errors, but is not an atomic Host attestation.
    const current = await refreshPendingApproval(
      expectedVersion,
      async () => {
        const snapshot = await connection.chatSnapshot(pending.attention.resourceUri);
        if (this.connection !== connection || this.binding !== binding) {
          throw Object.assign(new Error('approval is no longer pending'), {
            code: 'not_pending' as const,
          });
        }
        // The live subscription may have delivered a newer event while the
        // snapshot request was in flight. Never overwrite that newer state.
        if (snapshot.fromSeq < this.sequence) return;

        this.sequence = snapshot.fromSeq;
        this.state = snapshot.state;
        this.syncPending(binding);
      },
      () => this.pending.get(attentionId),
    );

    const action: StateAction = decision === 'allow_once'
      ? {
          type: ActionType.ChatToolCallConfirmed,
          turnId: current.turnId,
          toolCallId: current.toolCallId,
          approved: true as const,
          confirmed: ToolCallConfirmationReason.UserAction,
        }
      : {
          type: ActionType.ChatToolCallConfirmed,
          turnId: current.turnId,
          toolCallId: current.toolCallId,
          approved: false as const,
          reason: ToolCallCancellationReason.Denied,
        };

    const ack = await connection.dispatch(current.attention.resourceUri, action);
    const resolved: AttentionProjection = {
      ...current.attention,
      state: decision === 'allow_once' ? 'resolved_allow' : 'resolved_reject',
      version: ack.serverSeq,
      resolvedAt: new Date().toISOString(),
    };

    this.pending.delete(attentionId);
    this.options.onResolved(resolved);
    return resolved;
  }

  private async consume(binding: AhpBinding, subscription: Subscription): Promise<void> {
    try {
      for await (const event of subscription) this.observe(binding, event);
    } catch (error) {
      this.options.log(
        `AHP subscription ended: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private observe(binding: AhpBinding, event: SubscriptionEvent): void {
    if (
      event.type !== 'action' ||
      event.params.channel !== binding.chatUri ||
      event.params.rejectionReason ||
      event.params.serverSeq <= this.sequence ||
      !this.state
    ) return;

    this.sequence = event.params.serverSeq;
    this.state = chatReducer(
      this.state,
      event.params.action as Parameters<typeof chatReducer>[1],
    );
    this.syncPending(binding);
  }

  private syncPending(binding: AhpBinding): void {
    const turn = this.state?.activeTurn;
    const seen = new Set<string>();

    for (const part of turn?.responseParts ?? []) {
      if (part.kind !== ResponsePartKind.ToolCall) continue;

      const tool = part.toolCall;
      if (
        tool.status !== ToolCallStatus.PendingConfirmation &&
        tool.status !== ToolCallStatus.PendingResultConfirmation
      ) continue;

      const id = makeAttentionId(binding, turn!.id, tool.toolCallId);
      seen.add(id);

      const preExecution = tool.status === ToolCallStatus.PendingConfirmation;
      const hasEdits = preExecution && Boolean(tool.edits);
      const title = preExecution
        ? text(tool.confirmationTitle) || tool.displayName
        : `确认 ${tool.displayName} 的结果`;

      const candidate: AttentionProjection = {
        id,
        machineId: this.options.machineId,
        sessionId: binding.sessionUri,
        resourceUri: binding.chatUri,
        kind: hasEdits ? 'file_write' : 'command',
        projectName: binding.label,
        title: title || 'Codex 请求确认',
        summary: text(tool.invocationMessage) || tool.intention || tool.toolName,
        impact: hasEdits ? ['文件修改'] : ['本机工具执行'],
        state: 'pending',
        version: Math.max(1, this.sequence),
        observedAt: new Date().toISOString(),
      };

      const previous = this.pending.get(id);
      const attention = reconcilePendingAttention(previous?.attention, candidate, this.sequence);
      if (previous && attention === previous.attention) continue;

      this.pending.set(id, {
        attention,
        turnId: turn!.id,
        toolCallId: tool.toolCallId,
      });
      this.options.onAttention(attention);
    }

    for (const [id, previous] of [...this.pending]) {
      if (seen.has(id)) continue;

      this.pending.delete(id);
      this.options.onResolved({
        ...previous.attention,
        state: 'resolved_elsewhere',
        version: Math.max(previous.attention.version + 1, this.sequence),
        resolvedAt: new Date().toISOString(),
      });
    }
  }
}
