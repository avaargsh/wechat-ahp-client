import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttentionProjection } from '@wechat-ahp/protocol';
import {
  reconcilePendingAttention,
  refreshPendingApproval,
} from '../src/ahp/pending-attention.ts';

const original: AttentionProjection = {
  id: 'att-same-tool',
  machineId: 'machine-a',
  sessionId: 'session-a',
  resourceUri: 'ahp-chat://chat-a',
  version: 7,
  kind: 'command',
  title: 'Run command',
  summary: 'npm test',
  impact: ['本机工具执行'],
  state: 'pending',
  observedAt: '2026-11-24T00:00:00.000Z',
};

type Entry = {
  attention: AttentionProjection;
  turnId: string;
  toolCallId: string;
};

function entry(attention = original): Entry {
  return { attention, turnId: 'turn-a', toolCallId: 'tool-a' };
}

test('keeps the first pending projection', () => {
  assert.equal(reconcilePendingAttention(undefined, original, 7), original);
});

test('does not invalidate an unchanged action when unrelated Host events advance sequence', () => {
  const next = { ...original, version: 8, observedAt: '2026-11-24T00:00:01.000Z' };
  const result = reconcilePendingAttention(original, next, 8);
  assert.equal(result, original);
  assert.equal(result.version, 7);
  assert.equal(result.summary, 'npm test');
});

test('updates the same Attention ID and bumps version when visible Host content changes', () => {
  const next = { ...original, version: 8, summary: 'npm run deploy', observedAt: '2026-11-24T00:00:02.000Z' };
  const result = reconcilePendingAttention(original, next, 8);
  assert.notEqual(result, original);
  assert.equal(result.id, original.id);
  assert.equal(result.summary, 'npm run deploy');
  assert.equal(result.version, 8);
});

test('keeps the version monotonic if the Host sequence is behind the projection', () => {
  const next = { ...original, summary: 'npm run deploy', version: 6 };
  const result = reconcilePendingAttention(original, next, 6);
  assert.equal(result.version, 8);
});

test('detects changes to identity, title, kind, workspace and impact', () => {
  const changes: Partial<AttentionProjection>[] = [
    { machineId: 'machine-b' },
    { sessionId: 'session-b' },
    { resourceUri: 'ahp-chat://chat-b' },
    { kind: 'file_write' },
    { projectName: 'another project' },
    { title: 'Deploy' },
    { cwd: '/production' },
    { impact: ['production deployment'] },
  ];
  for (const change of changes) {
    const result = reconcilePendingAttention(original, { ...original, ...change }, 7);
    assert.equal(result.version, 8, JSON.stringify(change));
  }
});

test('fresh Host content changes block dispatch and publish a new version', async () => {
  let current = entry();
  let dispatches = 0;
  await assert.rejects(
    refreshPendingApproval(
      original.version,
      async () => {
        current = entry(reconcilePendingAttention(
          current.attention,
          { ...current.attention, summary: 'npm run deploy', version: 8 },
          8,
        ));
      },
      () => current,
    ),
    (error: unknown) => (error as { code?: string }).code === 'version_conflict',
  );
  if (current.attention.version === original.version) dispatches++;
  assert.equal(current.attention.summary, 'npm run deploy');
  assert.equal(current.attention.version, 8);
  assert.equal(dispatches, 0);
});

test('unchanged fresh Host content preserves the reviewed version and allows one dispatch', async () => {
  let current = entry();
  let dispatches = 0;
  const approved = await refreshPendingApproval(
    original.version,
    async () => {
      current = entry(reconcilePendingAttention(
        current.attention,
        { ...current.attention, version: 8, observedAt: '2026-11-24T00:00:03.000Z' },
        8,
      ));
    },
    () => current,
  );
  assert.equal(approved.attention.version, original.version);
  dispatches++;
  assert.equal(dispatches, 1);
});

test('missing pending item fails closed after Host refresh', async () => {
  let current: Entry | undefined = entry();
  await assert.rejects(
    refreshPendingApproval(original.version, async () => { current = undefined; }, () => current),
    (error: unknown) => (error as { code?: string }).code === 'not_pending',
  );
});

test('Host snapshot errors propagate and prevent dispatch', async () => {
  const failure = new Error('Host snapshot unavailable');
  let dispatches = 0;
  await assert.rejects(
    refreshPendingApproval(original.version, async () => { throw failure; }, () => entry()),
    error => error === failure,
  );
  assert.equal(dispatches, 0);
});
