import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttentionProjection, ResolveDecision } from '@wechat-ahp/protocol';
import { submitReviewedApproval } from '../src/lib/approval';

const displayed: AttentionProjection = {
  id: 'att-reviewed',
  machineId: 'machine-a',
  sessionId: 'session-a',
  resourceUri: 'ahp-chat://chat-a',
  version: 7,
  kind: 'command',
  title: 'Run tests',
  summary: 'npm test',
  impact: ['local test execution'],
  state: 'pending',
  observedAt: '2026-10-07T00:00:00.000Z',
};

for (const decision of ['allow_once', 'reject'] as const) {
  test(`${decision} stops when preflight discovers an unseen version`, async () => {
    const latest = { ...displayed, version: 8, summary: 'npm run deploy' };
    const result = await submitReviewedApproval(displayed, decision, {
      read: async id => {
        assert.equal(id, displayed.id);
        return latest;
      },
      resolve: async () => assert.fail('must not decide on an unseen action'),
      onDispatch: () => assert.fail('must not enter the waiting-Host phase'),
    });
    assert.equal(result.status, 'changed');
    assert.equal(result.attention, latest);
  });
}

test('version changes alone require review, including an older projection', async () => {
  for (const version of [6, 8]) {
    const result = await submitReviewedApproval(displayed, 'allow_once', {
      read: async () => ({ ...displayed, version }),
      resolve: async () => assert.fail('must not replace the reviewed version'),
    });
    assert.equal(result.status, 'changed');
  }
});

test('changed identity or displayed scope fails closed even at the same version', async () => {
  const changes: Partial<AttentionProjection>[] = [
    { id: 'att-other' },
    { machineId: 'machine-b' },
    { sessionId: 'session-b' },
    { resourceUri: 'ahp-chat://chat-b' },
    { kind: 'file_write' },
    { projectName: 'another project' },
    { title: 'Deploy' },
    { summary: 'npm run deploy' },
    { cwd: '/different-workspace' },
    { impact: ['production deployment'] },
  ];
  for (const change of changes) {
    const result = await submitReviewedApproval(displayed, 'allow_once', {
      read: async () => ({ ...displayed, ...change }),
      resolve: async () => assert.fail(`unexpected dispatch: ${JSON.stringify(change)}`),
    });
    assert.equal(result.status, 'changed');
  }
});

test('another client resolving the approval prevents dispatch', async () => {
  for (const state of ['resolved_allow', 'resolved_reject', 'resolved_elsewhere', 'cancelled', 'expired'] as const) {
    const latest = { ...displayed, state, version: 8 };
    const result = await submitReviewedApproval(displayed, 'allow_once', {
      read: async () => latest,
      resolve: async () => assert.fail('terminal approvals cannot be dispatched'),
    });
    assert.deepEqual(result, { status: 'already_resolved', attention: latest });
  }
});

test('unchanged content submits the reviewed version and waits for the Host result', async () => {
  const events: string[] = [];
  let finish!: (value: AttentionProjection) => void;
  const ack = new Promise<AttentionProjection>(resolve => { finish = resolve; });
  let finished = false;
  const work = submitReviewedApproval(displayed, 'allow_once', {
    read: async () => ({ ...displayed, observedAt: '2026-10-07T00:01:00.000Z' }),
    onDispatch: () => { events.push('waiting_host'); },
    resolve: async (id, input) => {
      events.push('resolve');
      assert.equal(id, displayed.id);
      assert.deepEqual(input, { decision: 'allow_once', expectedVersion: 7 });
      return ack;
    },
  }).then(result => { finished = true; return result; });
  await Promise.resolve();
  assert.deepEqual(events, ['waiting_host', 'resolve']);
  assert.equal(finished, false);
  const terminal: AttentionProjection = { ...displayed, state: 'resolved_allow', version: 8 };
  finish(terminal);
  assert.deepEqual(await work, { status: 'resolved', attention: terminal });
});

test('new content can be submitted after a separate decision on the refreshed view', async () => {
  const latest = { ...displayed, summary: 'npm run lint', version: 8 };
  const refresh = await submitReviewedApproval(displayed, 'allow_once', {
    read: async () => latest,
    resolve: async () => assert.fail('first tap must only refresh'),
  });
  assert.equal(refresh.status, 'changed');
  let calls = 0;
  const accepted = await submitReviewedApproval(refresh.attention, 'allow_once', {
    read: async () => latest,
    resolve: async (_id, input) => {
      calls++;
      assert.equal(input.expectedVersion, 8);
      return { ...latest, state: 'resolved_allow', version: 9 };
    },
  });
  assert.equal(calls, 1);
  assert.equal(accepted.attention.state, 'resolved_allow');
});

test('preflight failures and Host conflicts propagate without automatic retries', async () => {
  const failure = new Error('offline');
  await assert.rejects(submitReviewedApproval(displayed, 'reject', {
    read: async () => { throw failure; },
    resolve: async () => assert.fail('failed preflight cannot dispatch'),
  }), error => error === failure);

  for (const decision of ['allow_once', 'reject'] as ResolveDecision[]) {
    let calls = 0;
    const conflict = Object.assign(new Error('changed after preflight'), { code: 'version_conflict' });
    await assert.rejects(submitReviewedApproval(displayed, decision, {
      read: async () => displayed,
      resolve: async () => { calls++; throw conflict; },
    }), error => error === conflict);
    assert.equal(calls, 1);
  }
});
