import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Agent, createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import test from 'node:test';

// Resolve the downloader Taro actually uses through pnpm's isolated graph.
let require = createRequire(new URL('../apps/miniprogram/package.json', import.meta.url));
for (const dependency of ['@tarojs/cli', 'download-git-repo']) {
  require = createRequire(require.resolve(`${dependency}/package.json`));
}
const download = require('download');
const got = createRequire(require.resolve('download/package.json'))('got');

async function localServer(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const agent = new Agent();
  // Bypass environment proxies and reject any accidental external request.
  agent.createConnection = (options, callback) => {
    if (options.host !== '127.0.0.1' || Number(options.port) !== port) {
      callback(new Error('Toolchain tests only allow their loopback server'));
      return;
    }
    return createConnection(options, callback);
  };
  t.after(async () => {
    agent.destroy();
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  return { url: `http://127.0.0.1:${port}`, options: { agent, retries: 0, timeout: 2000 } };
}

test('Taro template downloader preserves encoded and repeated query values', { timeout: 5000 }, async t => {
  const requests = [];
  const { url, options } = await localServer(t, (req, res) => {
    requests.push(req.url);
    res.end('template archive');
  });
  const path = '/template?tag=one&tag=two&text=%E4%B8%AD%E6%96%87&space=a+b&literal=a%2Bb&path=a%2Fb';
  const archive = await download(`${url}${path}`, options);
  assert.ok(Buffer.isBuffer(archive));
  assert.equal(archive.toString(), 'template archive');
  assert.deepEqual(requests, [path]);
});

test('Taro template downloader follows redirects and retains binary bytes', { timeout: 5000 }, async t => {
  const requests = [];
  const bytes = Buffer.from([0, 255, 128, 13, 10, 65, 0]);
  const destination = '/archive?token=a%2Bb%2Fc&tag=one&tag=two';
  const { url, options } = await localServer(t, (req, res) => {
    requests.push(req.url);
    if (req.url === '/redirect') {
      res.writeHead(302, { location: destination });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.end(bytes);
  });
  assert.deepEqual(await download(`${url}/redirect`, options), bytes);
  assert.deepEqual(requests, ['/redirect', destination]);
});

test('got cache preserves query identity and authorization variants', { timeout: 5000 }, async t => {
  let requests = 0;
  const { url, options } = await localServer(t, (req, res) => {
    requests++;
    res.writeHead(200, { 'cache-control': 'public, max-age=60', vary: 'Authorization' });
    res.end(`${req.url}|${req.headers.authorization}`);
  });
  const cache = new Map();
  const request = (path, authorization) => got(`${url}${path}`, {
    ...options, cache, headers: { authorization }
  });
  const first = await request('/cached?tag=one&tag=two', 'test-user-a');
  assert.equal(first.body, '/cached?tag=one&tag=two|test-user-a');
  assert.equal((await request('/cached?tag=one&tag=two', 'test-user-a')).body, first.body);
  assert.equal(requests, 1, 'identical requests should reuse the cached response');
  assert.equal((await request('/cached?tag=two&tag=one', 'test-user-a')).body,
    '/cached?tag=two&tag=one|test-user-a');
  assert.equal((await request('/cached?tag=one&tag=two', 'test-user-b')).body,
    '/cached?tag=one&tag=two|test-user-b');
  assert.equal(requests, 3, 'different query values and authorization must reach the server');
});
