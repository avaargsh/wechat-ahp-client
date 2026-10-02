import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttentionProjection } from '@wechat-ahp/protocol';
import {
  NotificationJournal,
  WeChatNotifier,
} from './wechatNotification.js';

function attention(): AttentionProjection {
  return {
    id: 'att_opaque',
    machineId: 'machine-a',
    sessionId: 'secret-session',
    resourceUri: 'ahp-chat://secret',
    kind: 'command',
    projectName: 'Sensitive project title',
    title: 'Run rm -rf /secret',
    summary: 'rm -rf /very/secret/path',
    cwd: '/Users/ben/private',
    impact: ['secret'],
    state: 'pending',
    version: 1,
    observedAt: '2026-10-02T00:00:00.000Z',
  };
}

test('notification projection sends only configured safe placeholders', async () => {
  const requests: { url: string; body?: string }[] = [];

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });

    if (url.includes('/cgi-bin/token')) {
      return new Response(JSON.stringify({
        access_token: 'access-token',
        expires_in: 7200,
      }), { status: 200 });
    }

    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 });
  };

  const notifier = new WeChatNotifier(
    'appid',
    'secret',
    'template-id',
    JSON.stringify({
      thing1: 'Codex 待确认',
      thing2: '{{kind}}',
    }),
    'developer',
    fakeFetch,
  );

  await notifier.send('openid-a', attention());

  const send = requests.find(request => request.url.includes('/message/subscribe/send'));
  assert.ok(send?.body);

  const payload = JSON.parse(send!.body!);
  assert.equal(payload.touser, 'openid-a');
  assert.equal(payload.page, 'pages/approval/index?id=att_opaque');
  assert.equal(payload.data.thing2.value, '命令执行');

  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('rm -rf'), false);
  assert.equal(serialized.includes('/Users/ben/private'), false);
  assert.equal(serialized.includes('Sensitive project title'), false);
});

test('notification journal allows one attempt per OpenID and attention', () => {
  const journal = new NotificationJournal();

  assert.equal(journal.begin('openid-a', 'att-1'), true);
  assert.equal(journal.begin('openid-a', 'att-1'), false);
  assert.equal(journal.begin('openid-a', 'att-2'), true);
  assert.equal(journal.begin('openid-b', 'att-1'), true);
});

test('notification sender stays disabled without template configuration', () => {
  const notifier = new WeChatNotifier('appid', 'secret', undefined, undefined);
  assert.deepEqual(notifier.publicConfig(), { enabled: false, templateId: undefined });
});
