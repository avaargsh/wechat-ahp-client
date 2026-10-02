import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type {
  AttentionProjection,
  ConnectorToRelay,
  PairingTicket,
  RelayToConnector,
  ResolveDecision,
} from '@wechat-ahp/protocol';

export interface RelayClientOptions {
  relayUrl: string;
  connectorToken: string;
  machineId: string;
  displayName: string;
  onConnected?(): void;
  onResolve(
    attentionId: string,
    decision: ResolveDecision,
    expectedVersion: number,
  ): Promise<AttentionProjection>;
  log(message: string): void;
}

interface PendingPairing {
  resolve(ticket: PairingTicket): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class RelayClient {
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = true;
  private attempts = 0;
  private readonly pendingPairings = new Map<string, PendingPairing>();

  constructor(private readonly options: RelayClientOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.rejectPairings(new Error('relay connector stopped'));
    this.ws?.close(1000, 'stopped');
    this.ws = undefined;
  }

  sync(attentions: AttentionProjection[]): void {
    this.send({
      type: 'attention.snapshot',
      machineId: this.options.machineId,
      attentions,
    });
  }

  publish(attention: AttentionProjection): void {
    this.send({ type: 'attention.upsert', attention });
  }

  publishResolved(attention: AttentionProjection): void {
    this.send({ type: 'attention.resolved', attention });
  }

  createPairing(): Promise<PairingTicket> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('relay is not connected'));
    }

    const requestId = randomUUID();
    const promise = new Promise<PairingTicket>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPairings.delete(requestId);
        reject(new Error('pairing request timed out'));
      }, 10_000);
      this.pendingPairings.set(requestId, { resolve, reject, timer });
    });

    this.send({
      type: 'pairing.create',
      requestId,
      machineId: this.options.machineId,
    });

    return promise;
  }

  private connect(): void {
    if (this.stopped) return;

    const url = new URL(this.options.relayUrl);
    url.searchParams.set('machineId', this.options.machineId);

    const ws = new WebSocket(url, {
      headers: {
        authorization: `Bearer ${this.options.connectorToken}`,
      },
    });
    this.ws = ws;

    ws.on('open', () => {
      this.attempts = 0;
      this.options.log('Relay connected.');
      this.send({
        type: 'connector.hello',
        machineId: this.options.machineId,
        displayName: this.options.displayName,
        version: '0.0.1',
      });
      this.options.onConnected?.();
    });

    ws.on('message', raw => {
      try {
        void this.handle(JSON.parse(raw.toString()) as RelayToConnector);
      } catch {
        this.options.log('Relay sent malformed JSON.');
      }
    });

    ws.on('error', error => this.options.log(`Relay error: ${error.message}`));

    ws.on('close', () => {
      if (this.ws === ws) this.ws = undefined;
      this.rejectPairings(new Error('relay disconnected'));
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private async handle(message: RelayToConnector): Promise<void> {
    if (message.type === 'pairing.create.result') {
      const pending = this.pendingPairings.get(message.requestId);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pendingPairings.delete(message.requestId);

      if (message.ok) pending.resolve(message.ticket);
      else pending.reject(new Error(message.error));
      return;
    }

    if (message.type !== 'approval.resolve') return;

    try {
      const attention = await this.options.onResolve(
        message.attentionId,
        message.decision,
        message.expectedVersion,
      );

      this.send({
        type: 'approval.resolve.result',
        requestId: message.requestId,
        ok: true,
        attention,
      });
    } catch (error) {
      const code = (error as {
        code?: 'not_pending' | 'version_conflict';
      }).code;

      this.send({
        type: 'approval.resolve.result',
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : 'resolve failed',
        ...(code ? { code } : {}),
      });
    }
  }

  private send(message: ConnectorToRelay): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private rejectPairings(error: Error): void {
    for (const pending of this.pendingPairings.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingPairings.clear();
  }

  private scheduleReconnect(): void {
    const delay = Math.min(30_000, 1_000 * 2 ** this.attempts++);
    this.options.log(`Relay disconnected; retrying in ${delay}ms.`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
