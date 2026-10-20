import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { WebSocket } from 'ws';

interface PairedToken {
  token: string;
  machineId: string;
}

test('HTTP unpair revokes only the paired token; legacy bearer cannot revoke', { timeout: 20_000 }, async t => {
  // Run the real Relay with an ephemeral port; do not bind the test to 8787.
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('./index.ts', import.meta.url))],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: '0',
        CONNECTOR_TOKEN: 'test-connector',
        MOBILE_TOKEN: 'test-legacy-mobile',
        WX_APPID: '',
        WX_APP_SECRET: '',
        WX_SUBSCRIBE_TEMPLATE_ID: '',
        WX_SUBSCRIBE_TEMPLATE_DATA: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  t.after(() => { child.kill('SIGTERM'); });

  const port = await new Promise<number>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error('Relay did not start: ' + output.slice(-1000)));
    }, 12_000);
    child.stderr?.on('data', chunk => { output += chunk.toString(); });
    child.stdout?.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/wechat-ahp relay listening on :(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.once('error', err => { clearTimeout(timeout); reject(err); });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error('Relay exited before listening: ' + code + ' ' + output.slice(-1000)));
    });
  });

  const origin = `http://127.0.0.1:${port}`;
  const connector = new WebSocket(
    `ws://127.0.0.1:${port}/connector?machineId=machine-a`,
    { headers: { authorization: 'Bearer test-connector' } },
  );
  t.after(() => { connector.terminate(); });
  await new Promise<void>((resolve, reject) => {
    connector.once('open', resolve);
    connector.once('error', reject);
  });

  let sequence = 0;
  async function createSession(): Promise<PairedToken> {
    const requestId = `pair-${++sequence}`;
    const ticket = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        connector.off('message', onMessage);
        reject(new Error('missing pairing response'));
      }, 3_000);
      function onMessage(raw: WebSocket.RawData) {
        const message = JSON.parse(raw.toString()) as {
          type: string;
          requestId: string;
          ok?: boolean;
          ticket?: { code: string };
        };
        if (message.type !== 'pairing.create.result' || message.requestId !== requestId) return;
        clearTimeout(timeout);
        connector.off('message', onMessage);
        if (!message.ok || !message.ticket) {
          reject(new Error('pairing creation failed'));
        } else {
          resolve(message.ticket.code);
        }
      }
      connector.on('message', onMessage);
    });
    connector.send(JSON.stringify({ type: 'pairing.create', machineId: 'machine-a', requestId }));
    const response = await fetch(origin + '/api/pairing/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: await ticket, deviceName: 'Test Phone' }),
    });
    assert.equal(response.status, 201);
    return await response.json() as PairedToken;
  }

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  const first = await createSession();
  const second = await createSession();
  assert.equal(first.machineId, 'machine-a');
  assert.equal(second.machineId, 'machine-a');
  assert.notEqual(first.token, second.token);

  const initial = await fetch(origin + '/api/session', { headers: auth(first.token) });
  assert.equal(initial.status, 200);

  const removed = await fetch(origin + '/api/session', {
    method: 'DELETE',
    headers: auth(first.token),
  });
  assert.equal(removed.status, 204);
  assert.equal(await removed.text(), '');

  assert.equal(
    (await fetch(origin + '/api/session', { headers: auth(first.token) })).status,
    401,
  );
  assert.equal(
    (await fetch(origin + '/api/session', {
      method: 'DELETE', headers: auth(first.token),
    })).status,
    401,
  );
  assert.equal(
    (await fetch(origin + '/api/session', { headers: auth(second.token) })).status,
    200,
  );

  assert.equal(
    (await fetch(origin + '/api/session', {
      method: 'DELETE',
      headers: auth('test-legacy-mobile'),
    })).status,
    403,
  );
  // A legacy-token revoke attempt cannot invalidate another paired token.
  assert.equal(
    (await fetch(origin + '/api/session', { headers: auth(second.token) })).status,
    200,
  );
});
