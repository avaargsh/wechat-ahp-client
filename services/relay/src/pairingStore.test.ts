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
