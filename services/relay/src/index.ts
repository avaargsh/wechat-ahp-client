import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  ApiError,
  AttentionState,
  AttentionProjection,
  ConnectorToRelay,
  MobileSession,
  PairingClaimInput,
  RelayToConnector,
  ResolveAttentionInput,
} from '@wechat-ahp/protocol';
import { AttentionStore } from './store.js';
import { PairingStore } from './pairingStore.js';
import { WeChatAuth } from './wechatAuth.js';

const port = Number(process.env.PORT ?? 8787);
const legacyMobileToken = process.env.MOBILE_TOKEN;
const connectorToken = process.env.CONNECTOR_TOKEN ?? 'dev-connector';
const resolveTimeoutMs = Number(process.env.RESOLVE_TIMEOUT_MS ?? 10_000);

const attentions = new AttentionStore();
const pairings = new PairingStore();
const wechatAuth = new WeChatAuth();
const connectors = new Map<string, WebSocket>();
const pendingResolutions = new Map<string, {
  resolve: (value: AttentionProjection) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}>();

interface AuthContext {
  machineId?: string;
  session?: MobileSession;
  legacy: boolean;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function apiError(res: ServerResponse, status: number, code: ApiError['code'], error: string): void {
  json(res, status, { code, error } satisfies ApiError);
}

function bearer(req: IncomingMessage): string | undefined {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) return;
  return value.slice('Bearer '.length).trim() || undefined;
}

function authorize(req: IncomingMessage): AuthContext | undefined {
  const token = bearer(req);
  if (!token) return;

  const session = pairings.authorize(token);
  if (session) {
    return {
      machineId: session.machineId,
      session,
      legacy: false,
    };
  }

  if (legacyMobileToken && token === legacyMobileToken) {
    return { legacy: true };
  }
}

function visibleTo(auth: AuthContext, attention: AttentionProjection): boolean {
  return !auth.machineId || attention.machineId === auth.machineId;
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error('request body too large');
  }
  return JSON.parse(body || '{}') as T;
}

function send(ws: WebSocket, message: RelayToConnector): void {
  if (ws.readyState !== WebSocket.OPEN) throw new Error('connector is not open');
  ws.send(JSON.stringify(message));
}

async function resolveAttention(
  attention: AttentionProjection,
  input: ResolveAttentionInput,
): Promise<AttentionProjection> {
  if (attention.state !== 'pending') return attention;

  if (attention.version !== input.expectedVersion) {
    throw Object.assign(new Error('version conflict'), { code: 'version_conflict' });
  }

  const ws = connectors.get(attention.machineId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw Object.assign(new Error('machine offline'), { code: 'machine_offline' });
  }

  const requestId = randomUUID();
  const result = new Promise<AttentionProjection>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResolutions.delete(requestId);
      reject(Object.assign(new Error('connector timeout'), { code: 'connector_timeout' }));
    }, resolveTimeoutMs);
    pendingResolutions.set(requestId, { resolve, reject, timer });
  });

  send(ws, {
    type: 'approval.resolve',
    requestId,
    attentionId: attention.id,
    expectedVersion: input.expectedVersion,
    decision: input.decision,
  });

  return result;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, {
        ok: true,
        connectors: connectors.size,
        attentions: attentions.size,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/pairing/claim') {
      const input = await readJson<PairingClaimInput>(req);
      if (!input.code || typeof input.code !== 'string') {
        return apiError(res, 400, 'bad_request', 'pairing code is required');
      }

      let identity;
      try {
        identity = await wechatAuth.exchange(input.wechatCode);
      } catch (error) {
        console.warn('WeChat login verification failed', error);
        return apiError(res, 401, 'unauthorized', 'WeChat login verification failed');
      }

      const session = pairings.claim(
        input.code,
        input.deviceName,
        Date.now(),
        identity?.openId,
      );
      if (!session) {
        return apiError(res, 401, 'unauthorized', 'pairing code is invalid or expired');
      }

      json(res, 201, session);
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      apiError(res, 404, 'not_found', 'not found');
      return;
    }

    const auth = authorize(req);
    if (!auth) {
      apiError(res, 401, 'unauthorized', 'unauthorized');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/session') {
      json(res, 200, auth.session ?? {
        machineId: null,
        deviceName: 'legacy development token',
        expiresAt: null,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/attention') {
      const state = url.searchParams.get('state') as AttentionState | null;
      const items = attentions
        .list(state ?? undefined)
        .filter(item => visibleTo(auth, item));
      json(res, 200, { items });
      return;
    }

    const detail = url.pathname.match(/^\/api\/attention\/([^/]+)$/);
    if (req.method === 'GET' && detail) {
      const item = attentions.get(decodeURIComponent(detail[1]!));
      if (!item || !visibleTo(auth, item)) {
        return apiError(res, 404, 'not_found', 'attention not found');
      }
      json(res, 200, item);
      return;
    }

    const resolve = url.pathname.match(/^\/api\/attention\/([^/]+)\/resolve$/);
    if (req.method === 'POST' && resolve) {
      const id = decodeURIComponent(resolve[1]!);
      const item = attentions.get(id);
      if (!item || !visibleTo(auth, item)) {
        return apiError(res, 404, 'not_found', 'attention not found');
      }

      const input = await readJson<ResolveAttentionInput>(req);
      if (
        !['allow_once', 'reject'].includes(input.decision) ||
        !Number.isInteger(input.expectedVersion)
      ) {
        return apiError(res, 400, 'bad_request', 'invalid resolve request');
      }

      if (item.state !== 'pending') {
        json(res, 200, item);
        return;
      }

      try {
        json(res, 200, await resolveAttention(item, input));
      } catch (error) {
        const code = (error as { code?: ApiError['code'] }).code;
        if (code === 'version_conflict') {
          return apiError(res, 409, code, 'attention changed; refresh first');
        }
        if (code === 'machine_offline') {
          return apiError(res, 503, code, 'development machine is offline');
        }
        if (code === 'connector_timeout') {
          return apiError(res, 504, code, 'connector did not confirm the action');
        }
        throw error;
      }
      return;
    }

    apiError(res, 404, 'not_found', 'not found');
  } catch (error) {
    console.error(error);
    apiError(res, 500, 'bad_request', 'unexpected relay failure');
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (
    url.pathname !== '/connector' ||
    req.headers.authorization !== `Bearer ${connectorToken}` ||
    !url.searchParams.get('machineId')
  ) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    const machineId = url.searchParams.get('machineId')!;
    connectors.get(machineId)?.close(4001, 'replaced');
    connectors.set(machineId, ws);

    ws.on('close', () => {
      if (connectors.get(machineId) === ws) connectors.delete(machineId);
    });

    ws.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString()) as ConnectorToRelay;

        if (message.type === 'pairing.create') {
          if (message.machineId !== machineId) {
            throw new Error('pairing machine does not match authenticated connector');
          }

          send(ws, {
            type: 'pairing.create.result',
            requestId: message.requestId,
            ok: true,
            ticket: pairings.create(machineId),
          });
          return;
        }

        if (message.type === 'attention.snapshot') {
          if (message.machineId !== machineId) {
            throw new Error('snapshot machine does not match authenticated connector');
          }
          attentions.reconcile(machineId, message.attentions);
          return;
        }

        if (message.type === 'attention.upsert' || message.type === 'attention.resolved') {
          if (message.attention.machineId !== machineId) {
            throw new Error('attention machine does not match authenticated connector');
          }
          attentions.upsert(message.attention);
          return;
        }

        if (message.type === 'approval.resolve.result') {
          const pending = pendingResolutions.get(message.requestId);
          if (!pending) return;

          clearTimeout(pending.timer);
          pendingResolutions.delete(message.requestId);

          if (message.ok) {
            attentions.upsert(message.attention);
            pending.resolve(message.attention);
          } else {
            if (message.attention) attentions.upsert(message.attention);
            pending.reject(new Error(message.error));
          }
        }
      } catch (error) {
        console.error('bad connector message', error);
      }
    });
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`wechat-ahp relay listening on :${port}`);
});
