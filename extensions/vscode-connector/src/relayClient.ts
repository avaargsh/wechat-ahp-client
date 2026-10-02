import { WebSocket } from 'ws';
import type {
  AttentionProjection,
  ConnectorToRelay,
  RelayToConnector,
  ResolveDecision,
} from '@wechat-ahp/protocol';

export interface RelayClientOptions {
  relayUrl: string;
  connectorToken: string;
  machineId: string;
  displayName: string;
  onResolve(
    attentionId: string,
    decision: ResolveDecision,
    expectedVersion: number,
  ): Promise<AttentionProjection>;
  log(message: string): void;
}

export class RelayClient {
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = true;
  private attempts = 0;

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
    this.ws?.close(1000, 'stopped');
    this.ws = undefined;
  }

  publish(attention: AttentionProjection): void {
    this.send({ type: 'attention.upsert', attention });
  }

  publishResolved(attention: AttentionProjection): void {
    this.send({ type: 'attention.resolved', attention });
  }

  private connect(): void {
    if (this.stopped) return;
    const url = new URL(this.options.relayUrl);
    url.searchParams.set('machineId', this.options.machineId);
    url.searchParams.set('token', this.options.connectorToken);

    const ws = new WebSocket(url);
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
    });

    ws.on('message', raw => {
      void this.handle(JSON.parse(raw.toString()) as RelayToConnector);
    });

    ws.on('error', error => this.options.log(`Relay error: ${error.message}`));

    ws.on('close', () => {
      if (this.ws === ws) this.ws = undefined;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private async handle(message: RelayToConnector): Promise<void> {
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
      this.send({
        type: 'approval.resolve.result',
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : 'resolve failed',
      });
    }
  }

  private send(message: ConnectorToRelay): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(30_000, 1_000 * 2 ** this.attempts++);
    this.options.log(`Relay disconnected; retrying in ${delay}ms.`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
