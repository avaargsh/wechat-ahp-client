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
  type StringOrMarkdown,
} from '@microsoft/agent-host-protocol';
import type { Subscription, SubscriptionEvent } from '@microsoft/agent-host-protocol/client';
import type { AttentionProjection, ResolveDecision } from '@wechat-ahp/protocol';
import { discoverHosts, resolveHost } from './discovery.js';
import { HostConnection } from './connection.js';

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

function attentionId(binding: AhpBinding, turnId: string, toolCallId: string): string {
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
    this.pending.clear();
  }

  listPending(): AttentionProjection[] {
    return [...this.pending.values()].map(value => value.attention);
  }

  async resolve(
    attentionIdValue: string,
    decision: ResolveDecision,
    expectedVersion: number,
  ): Promise<AttentionProjection> {
    const pending = this.pending.get(attentionIdValue);
    const connection = this.connection;

    if (!pending || !connection) throw new Error('approval is no longer pending');
    if (pending.attention.version !== expectedVersion) {
      throw new Error('approval changed; refresh before deciding');
    }

    const action = decision === 'allow_once'
      ? {
          type: ActionType.ChatToolCallConfirmed,
          turnId: pending.turnId,
          toolCallId: pending.toolCallId,
          approved: true as const,
          confirmed: ToolCallConfirmationReason.UserAction,
        }
      : {
          type: ActionType.ChatToolCallConfirmed,
          turnId: pending.turnId,
          toolCallId: pending.toolCallId,
          approved: false as const,
          reason: ToolCallCancellationReason.Denied,
        };

    const ack = await connection.dispatch(pending.attention.resourceUri, action);
    const resolved: AttentionProjection = {
      ...pending.attention,
      state: decision === 'allow_once' ? 'resolved_allow' : 'resolved_reject',
      version: ack.serverSeq,
      resolvedAt: new Date().toISOString(),
    };

    this.pending.delete(attentionIdValue);
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
    this.state = chatReducer(this.state, event.params.action);
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

      const id = attentionId(binding, turn!.id, tool.toolCallId);
      seen.add(id);
      const existing = this.pending.get(id);
      if (existing) continue;

      const attention: AttentionProjection = {
        id,
        machineId: this.options.machineId,
        sessionId: binding.sessionUri,
        resourceUri: binding.chatUri,
        kind: tool.edits ? 'file_write' : 'command',
        title: text(tool.confirmationTitle) || tool.displayName || 'Codex 请求确认',
        summary: text(tool.invocationMessage) || tool.intention || tool.toolName,
        impact: tool.edits ? ['文件修改'] : ['本机工具执行'],
        state: 'pending',
        version: Math.max(1, this.sequence),
        observedAt: new Date().toISOString(),
      };

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
