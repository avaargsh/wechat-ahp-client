/*
 * Local Agent Host transport.
 *
 * The implementation follows the local endpoint/WebSocket approach used by the
 * MIT-licensed formulahendry/vscode-wechat-ahp project and Microsoft's AHP
 * client transport interface. See THIRD_PARTY_NOTICES.md.
 */
import { Agent } from 'node:http';
import { createConnection, type Socket } from 'node:net';
import {
  TransportError,
  type AhpTransport,
  type JsonRpcMessage,
  type TransportFrame,
} from '@microsoft/agent-host-protocol/client';
import WebSocket, { type RawData } from 'ws';
import type { DiscoveredHost, HostEndpoint } from './discovery.js';

interface Waiter {
  resolve(frame: TransportFrame | null): void;
  reject(error: Error): void;
}

class LocalAgent extends Agent {
  constructor(private readonly target: HostEndpoint) {
    super({ keepAlive: false });
  }

  override createConnection(): Socket {
    if (this.target.type === 'socket') return createConnection(this.target.path);
    return createConnection({
      host: this.target.host === 'localhost' ? '127.0.0.1' : this.target.host,
      port: this.target.port,
    });
  }
}

export class LocalTransport implements AhpTransport {
  private readonly inbox: TransportFrame[] = [];
  private readonly waiters: Waiter[] = [];
  private closed = false;
  private failure?: TransportError;

  static async connect(host: DiscoveredHost): Promise<LocalTransport> {
    const url = new URL('ws://localhost/');
    url.searchParams.set('tkn', host.connectionToken);

    const agent = new LocalAgent(host.endpoint);
    const socket = new WebSocket(url, {
      agent,
      handshakeTimeout: 10_000,
      perMessageDeflate: false,
      maxPayload: 4 * 1024 * 1024,
    });

    return new Promise((resolve, reject) => {
      const opened = () => {
        cleanup();
        resolve(new LocalTransport(socket));
      };
      const failed = () => {
        cleanup();
        socket.terminate();
        agent.destroy();
        reject(new Error('Cannot connect to local VS Code Agent Host.'));
      };
      const cleanup = () => {
        socket.off('open', opened);
        socket.off('error', failed);
      };

      socket.once('close', () => agent.destroy());
      socket.once('open', opened);
      socket.once('error', failed);
    });
  }

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data, isBinary) => {
      const bytes = rawBytes(data);
      this.deliver(
        isBinary
          ? { kind: 'binary', data: bytes }
          : { kind: 'text', text: bytes.toString('utf8') },
      );
    });

    socket.on('error', () => this.fail(new TransportError('io', 'Agent Host transport failed.')));
    socket.on('close', () => {
      this.closed = true;
      for (const waiter of this.waiters.splice(0)) waiter.resolve(null);
    });
  }

  send(message: JsonRpcMessage | string): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new TransportError('closed', 'Local transport is closed.'));
    }

    return new Promise((resolve, reject) => {
      this.socket.send(
        typeof message === 'string' ? message : JSON.stringify(message),
        error => error
          ? reject(new TransportError('io', 'Local transport send failed.'))
          : resolve(),
      );
    });
  }

  recv(): Promise<TransportFrame | null> {
    if (this.failure) return Promise.reject(this.failure);
    const frame = this.inbox.shift();
    if (frame) return Promise.resolve(frame);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async close(): Promise<void> {
    if (this.closed || this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        this.socket.terminate();
        resolve();
      }, 1_000);
      this.socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.close(1000);
    });
  }

  private deliver(frame: TransportFrame): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(frame);
    else this.inbox.push(frame);
  }

  private fail(error: TransportError): void {
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
}

function rawBytes(data: RawData): Buffer {
  return Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : data;
}
