import assert from 'node:assert/strict';
import test from 'node:test';
import { PairingStore } from './pairingStore.js';

test('pairing code can be claimed exactly once', () => {
  const store = new PairingStore(60_000, 120_000);
  const ticket = store.create('machine-a', 1_000);

  const first = store.claim(ticket.code.toLowerCase(), 'iPhone', 2_000);
  assert.equal(first?.machineId, 'machine-a');
  assert.equal(first?.deviceName, 'iPhone');
  assert.ok(first?.token);
  assert.equal(first?.wechatLinked, false);

  const second = store.claim(ticket.code, 'other', 3_000);
  assert.equal(second, undefined);
});

test('expired pairing code cannot be claimed', () => {
  const store = new PairingStore(1_000, 120_000);
  const ticket = store.create('machine-a', 1_000);

  assert.equal(store.claim(ticket.code, 'iPhone', 2_001), undefined);
});

test('mobile session expires independently from pairing code', () => {
  const store = new PairingStore(60_000, 1_000);
  const ticket = store.create('machine-a', 1_000);
  const session = store.claim(ticket.code, 'iPhone', 1_500)!;

  assert.equal(store.authorize(session.token, 2_499)?.machineId, 'machine-a');
  assert.equal(store.authorize(session.token, 2_501), undefined);
});

test('paired session exposes only a linked flag, never the OpenID', () => {
  const store = new PairingStore(60_000, 120_000);
  const ticket = store.create('machine-a', 1_000);
  const session = store.claim(ticket.code, 'iPhone', 2_000, 'openid-secret')!;

  assert.equal(session.wechatLinked, true);
  assert.equal(JSON.stringify(session).includes('openid-secret'), false);
  assert.equal(store.authorize(session.token, 2_500)?.wechatLinked, true);
});

test('notification consent is available only to WeChat-linked sessions', () => {
  const store = new PairingStore(60_000, 120_000);

  const unlinkedTicket = store.create('machine-a', 1_000);
  const unlinked = store.claim(unlinkedTicket.code, 'browser', 1_500)!;
  assert.equal(store.setNotificationsEnabled(unlinked.token, true, 2_000), undefined);

  const linkedTicket = store.create('machine-a', 3_000);
  const linked = store.claim(linkedTicket.code, 'iPhone', 3_500, 'openid-a')!;
  const enabled = store.setNotificationsEnabled(linked.token, true, 4_000);

  assert.equal(enabled?.notificationsEnabled, true);
  assert.deepEqual(store.notificationRecipients('machine-a', 4_500), [
    { sessionToken: linked.token, openId: 'openid-a' },
  ]);

  store.setNotificationsEnabled(linked.token, false, 5_000);
  assert.deepEqual(store.notificationRecipients('machine-a', 5_500), []);
});

test('duplicate sessions for one OpenID produce one notification recipient', () => {
  const store = new PairingStore(60_000, 120_000);

  const ticketA = store.create('machine-a', 1_000);
  const a = store.claim(ticketA.code, 'iPhone', 1_500, 'same-openid')!;
  store.setNotificationsEnabled(a.token, true, 2_000);

  const ticketB = store.create('machine-a', 3_000);
  const b = store.claim(ticketB.code, 'iPad', 3_500, 'same-openid')!;
  store.setNotificationsEnabled(b.token, true, 4_000);

  assert.equal(store.notificationRecipients('machine-a', 5_000).length, 1);
});

test('one notification attempt consumes consent across duplicate sessions', () => {
  const store = new PairingStore(60_000, 120_000);

  const ticketA = store.create('machine-a', 1_000);
  const a = store.claim(ticketA.code, 'iPhone', 1_500, 'same-openid')!;
  store.setNotificationsEnabled(a.token, true, 2_000);

  const ticketB = store.create('machine-a', 3_000);
  const b = store.claim(ticketB.code, 'iPad', 3_500, 'same-openid')!;
  store.setNotificationsEnabled(b.token, true, 4_000);

  store.consumeNotificationConsent('machine-a', 'same-openid', 5_000);
  assert.deepEqual(store.notificationRecipients('machine-a', 5_500), []);
});
