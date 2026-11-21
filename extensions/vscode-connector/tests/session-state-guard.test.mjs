import assert from 'node:assert/strict';
import test from 'node:test';
import { isSessionState } from '../src/ahp/session-state-guard.ts';

const valid = () => ({
  provider: 'codex',
  title: 'Local session',
  status: 1,
  lifecycle: 'ready',
  chats: [{ resource: 'ahp-chat:/abc', title: 'Chat' }],
  activeClients: [],
});

test('accepts a structurally valid AHP session state', () => {
  assert.equal(isSessionState(valid()), true);
  assert.equal(isSessionState({ ...valid(), chats: [] }), true);
});

test('rejects EmptyState, null and wrong-channel snapshots', () => {
  for (const snapshot of [{}, null, undefined, [], { turns: [] }]) {
    assert.equal(isSessionState(snapshot), false);
  }
});

test('rejects missing session metadata and invalid lifecycle', () => {
  for (const key of ['provider', 'title', 'status', 'lifecycle', 'chats', 'activeClients']) {
    const state = valid();
    delete state[key];
    assert.equal(isSessionState(state), false, `missing ${key}`);
  }
  assert.equal(isSessionState({ ...valid(), lifecycle: 'unknown' }), false);
  assert.equal(isSessionState({ ...valid(), status: 'idle' }), false);
});

test('rejects malformed chat collections and active clients', () => {
  for (const chats of [null, {}, [null], [{}], [{ resource: '' }]]) {
    assert.equal(isSessionState({ ...valid(), chats }), false);
  }
  assert.equal(isSessionState({ ...valid(), activeClients: null }), false);
});
