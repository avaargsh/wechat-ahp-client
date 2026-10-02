import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttentionProjection } from '@wechat-ahp/protocol';
import { AttentionStore } from './store.js';

function pending(
  id: string,
  machineId = 'machine-a',
  version = 1,
): AttentionProjection {
  return {
    id,
    machineId,
    sessionId: 'session',
    resourceUri: 'ahp-chat://chat',
    kind: 'command',
    title: 'Run command',
    summary: 'npm test',
    state: 'pending',
    version,
    observedAt: '2026-10-02T00:00:00.000Z',
  };
}

test('reconcile restores the connector authoritative set', () => {
  const store = new AttentionStore();

  const current = pending('att-1', 'machine-a', 4);
  const changed = store.reconcile('machine-a', [current]);

  assert.equal(store.get('att-1'), current);
  assert.deepEqual(changed, [current]);
});

test('reconcile closes stale pending approvals for that machine only', () => {
  const store = new AttentionStore();
  store.upsert(pending('stale-a', 'machine-a', 7));
  store.upsert(pending('keep-b', 'machine-b', 2));

  store.reconcile('machine-a', [], '2026-10-02T01:00:00.000Z');

  assert.equal(store.get('stale-a')?.state, 'resolved_elsewhere');
  assert.equal(store.get('stale-a')?.version, 8);
  assert.equal(store.get('stale-a')?.resolvedAt, '2026-10-02T01:00:00.000Z');
  assert.equal(store.get('keep-b')?.state, 'pending');
});

test('older projections cannot roll state backward', () => {
  const store = new AttentionStore();
  const newer = pending('att-1', 'machine-a', 9);
  store.upsert(newer);

  const older = pending('att-1', 'machine-a', 8);
  assert.equal(store.upsert(older), newer);
  assert.equal(store.get('att-1')?.version, 9);
});

test('snapshot rejects cross-machine records', () => {
  const store = new AttentionStore();

  assert.throws(
    () => store.reconcile('machine-a', [pending('att-1', 'machine-b')]),
    /another machine/,
  );
});
