import assert from 'node:assert/strict';
import test from 'node:test';
import { WeChatAuth } from './wechatAuth.js';

test('wechat auth is disabled when credentials are absent', async () => {
  const auth = new WeChatAuth(undefined, undefined);
  assert.equal(auth.enabled, false);
  assert.equal(await auth.exchange(undefined), undefined);
});

test('configured auth requires a wx.login code', async () => {
  const auth = new WeChatAuth('app', 'secret');
  await assert.rejects(() => auth.exchange(undefined), /login code is required/);
});

test('code2Session exchanges code without exposing session_key', async () => {
  let requested = '';

  const fakeFetch: typeof fetch = async input => {
    requested = String(input);
    return new Response(JSON.stringify({
      openid: 'openid-1',
      unionid: 'union-1',
      session_key: 'server-secret',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const auth = new WeChatAuth('app-id', 'app-secret', fakeFetch);
  const identity = await auth.exchange('login-code');

  assert.deepEqual(identity, { openId: 'openid-1', unionId: 'union-1' });
  assert.match(requested, /appid=app-id/);
  assert.match(requested, /js_code=login-code/);
  assert.equal(JSON.stringify(identity).includes('server-secret'), false);
});

test('code2Session API error fails closed', async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    errcode: 40029,
    errmsg: 'invalid code',
  }), { status: 200 });

  const auth = new WeChatAuth('app', 'secret', fakeFetch);
  await assert.rejects(() => auth.exchange('bad-code'), /invalid code/);
});
