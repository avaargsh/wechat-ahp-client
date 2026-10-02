import assert from 'node:assert/strict';
import test from 'node:test';
import { ResolutionGate } from './resolutionGate.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('identical duplicate resolutions share one in-flight operation', async () => {
  const gate = new ResolutionGate<string>();
  const work = deferred<string>();
  let calls = 0;

  const first = gate.run(
    'att-1',
    { decision: 'allow_once', expectedVersion: 7 },
    () => {
      calls += 1;
      return work.promise;
    },
  );
  const second = gate.run(
    'att-1',
    { decision: 'allow_once', expectedVersion: 7 },
    () => {
      calls += 1;
      return Promise.resolve('unexpected');
    },
  );

  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(first, second);

  work.resolve('ok');
  assert.equal(await first, 'ok');
  assert.equal(await second, 'ok');
});

test('conflicting decision fails closed while a resolution is in flight', async () => {
  const gate = new ResolutionGate<string>();
  const work = deferred<string>();

  const first = gate.run(
    'att-1',
    { decision: 'allow_once', expectedVersion: 7 },
    () => work.promise,
  );

  await assert.rejects(
    gate.run(
      'att-1',
      { decision: 'reject', expectedVersion: 7 },
      () => Promise.resolve('unexpected'),
    ),
    (error: unknown) =>
      (error as { code?: string }).code === 'resolution_in_progress',
  );

  work.resolve('ok');
  await first;
});

test('gate releases the attention after completion', async () => {
  const gate = new ResolutionGate<string>();
  let calls = 0;

  assert.equal(
    await gate.run(
      'att-1',
      { decision: 'allow_once', expectedVersion: 7 },
      async () => {
        calls += 1;
        return 'first';
      },
    ),
    'first',
  );

  assert.equal(
    await gate.run(
      'att-1',
      { decision: 'reject', expectedVersion: 8 },
      async () => {
        calls += 1;
        return 'second';
      },
    ),
    'second',
  );

  assert.equal(calls, 2);
});
