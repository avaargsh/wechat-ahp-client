import { randomUUID } from 'node:crypto';
import {
  SUPPORTED_PROTOCOL_VERSIONS,
  type ActionEnvelope,
  type ListSessionsResult,
  type SessionState,
  type StateAction,
} from '@microsoft/agent-host-protocol';
import { AhpClient, type ClientEvent } from '@microsoft/agent-host-protocol/client';
import type { DiscoveredHost } from './discovery.js';
import { LocalTransport } from './transport.js';

export class HostConnection {
  readonly client: AhpClient;
  readonly clientId = randomUUID();
  private readonly listeners = new Set<(event: ClientEvent) => void>();
  private readonly pending = new Map<number, {
    channel: string;
    resolve(value: ActionEnvelope): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  }>();
  private readonly consumeTask: Promise<void>;

  static async connect(host: DiscoveredHost): Promise<HostConnection> {
    const transport = await LocalTransport.connect(host);
    const connection = new HostConnection(transport);
    try {
      await connection.client.initialize({
        clientId: connection.clientId,
        protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        initialSubscriptions: ['ahp-root://'],
      });
      return connection;
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  private constructor(transport: LocalTransport) {
    this.client = new AhpClient(transport, {
      requestTimeoutMs: 10_000,
      subscriptionBuffer: 4096,
    });
    this.consumeTask = this.consume();
    this.client.connect();
  }

  onEvent(listener: (event: ClientEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async consume(): Promise<void> {
    for await (const event of this.client.events()) {
      if (event.event.type === 'action') {
        const envelope = event.event.params;
        if (envelope.origin?.clientId === this.clientId) {
          const pending = this.pending.get(envelope.origin.clientSeq);
          if (pending && pending.channel === envelope.channel) {
            clearTimeout(pending.timer);
            this.pending.delete(envelope.origin.clientSeq);
            if (envelope.rejectionReason) {
              pending.reject(new Error(`Agent Host rejected action: ${envelope.rejectionReason}`));
            } else {
              pending.resolve(envelope);
            }
          }
        }
      }

      for (const listener of this.listeners) listener(event);
    }
  }

  async listSessions(cursor?: string): Promise<ListSessionsResult> {
    return this.client.request('listSessions', {
      channel: 'ahp-root://',
      cursor,
      limit: 50,
    }) as Promise<ListSessionsResult>;
  }

  async session(uri: string): Promise<SessionState> {
    const { result, subscription } = await this.client.subscribe(uri);
    await subscription.close();
    const snapshot = result.snapshot;
    if (!snapshot || !snapshot.state || !('chats' in snapshot.state)) {
      throw new Error('Agent Host did not return a session snapshot.');
    }
    return snapshot.state;
  }

  dispatch(channel: string, action: StateAction): Promise<ActionEnvelope> {
    const { clientSeq } = this.client.dispatch(channel, action);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(clientSeq);
        reject(new Error('Agent Host acknowledgement timed out.'));
      }, 10_000);

      this.pending.set(clientSeq, { channel, resolve, reject, timer });
    });
  }

  async close(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Agent Host connection closed.'));
    }
    this.pending.clear();
    await this.client.shutdown();
    await this.consumeTask;
  }
}
