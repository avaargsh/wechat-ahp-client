import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./verify-real-device-acceptance.mjs', import.meta.url));
const fixturePath = fileURLToPath(new URL('./fixtures/real-device-acceptance.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const sha = fixture.source.commitSha;

function run(doc, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'wechat-acceptance-test-'));
  try {
    const path = join(dir, 'synthetic-test.json');
    writeFileSync(path, typeof doc === 'string' ? doc : JSON.stringify(doc));
    return spawnSync(process.execPath, [script, path, ...args], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function rejected(result, pattern) {
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, pattern);
}

test('the committed synthetic fixture is rejected by the real-device entry point', () => {
  rejected(run(fixture, ['--expected-commit', sha]), /real-device evidence required/);
});

test('explicit fixture validation never claims live verification or review eligibility', () => {
  const result = run(fixture, ['--allow-fixture']);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.contractVerified, true);
  assert.equal(summary.mode, 'contract-fixture');
  assert.equal(summary.eligibleForRealDeviceReview, false);
  assert.equal(summary.liveExecutionVerified, false);
  assert.equal(summary.observationBasis, 'synthetic');
  assert.equal(summary.verified, undefined);
});

test('operator-record format requires an independently supplied matching commit', () => {
  // This is a temporary format-test value, never a checked-in device record.
  const record = { ...fixture, mode: 'real-device' };
  rejected(run(record), /requires --expected-commit/);
  rejected(run(record, ['--expected-commit', '2'.repeat(40)]), /does not match/);
  rejected(run(record, ['--allow-fixture']), /accepts contract-fixture only/);
  const result = run(record, ['--expected-commit', sha]);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.sourceCommit, sha);
  assert.equal(summary.eligibleForRealDeviceReview, true);
  assert.equal(summary.observationBasis, 'operator-recorded');
  assert.equal(summary.liveExecutionVerified, false);
});

test('every required observation rejects absent, false or truthy non-boolean values', () => {
  const observations = Object.entries(fixture).flatMap(([section, fields]) =>
    fields && typeof fields === 'object'
      ? Object.keys(fields).filter(field => fields[field] === true).map(field => [section, field])
      : []);
  for (const [section, field] of observations) {
    for (const value of [undefined, false, 'true']) {
      const doc = structuredClone(fixture);
      doc[section][field] = value;
      rejected(run(doc, ['--allow-fixture']), new RegExp(`${section}\\.${field} must be true`));
    }
  }
});

test('legacy contracts, unfilled templates and malformed input fail without leaking contents', () => {
  rejected(run({ ...fixture, schemaVersion: 1 }, ['--allow-fixture']), /unsupported evidence contract/);
  const template = readFileSync(new URL('../acceptance/real-device.template.json', import.meta.url), 'utf8');
  rejected(run(template, ['--expected-commit', sha]), /placeholders/);
  for (const doc of [null, [], {}, '{"token":"do-not-print-me"']) {
    const result = run(doc, ['--allow-fixture']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /do-not-print-me|SyntaxError|at file:/);
  }
});

test('mismatched deep links, invalid commit identities and impossible timestamps are rejected', () => {
  const doc = structuredClone(fixture);
  doc.notification.deepLinkAttentionId = 'another-attention';
  rejected(run(doc, ['--allow-fixture']), /same opaque Attention/);
  for (const commitSha of ['main', '1234abcd', 'z'.repeat(40), 111]) {
    rejected(run({ ...fixture, source: { ...fixture.source, commitSha } }, ['--allow-fixture']), /full Git SHA/);
  }
  for (const recordedAt of ['yesterday', '2026-02-30T00:00:00Z', '2026-10-07', '2026-10-07T24:00:00Z']) {
    rejected(run({ ...fixture, recordedAt }, ['--allow-fixture']), /UTC ISO timestamp/);
  }
});

test('sensitive field aliases are rejected even inside nested arrays', () => {
  for (const key of ['session_key', 'AppSecret', 'access_token', 'ConnectorToken', 'tool_input', 'repository-path']) {
    const result = run({ ...fixture, extra: [{ [key]: 'sensitive-value' }] }, ['--allow-fixture']);
    rejected(result, /sensitive field/);
    assert.doesNotMatch(result.stderr, /sensitive-value/);
  }
});

test('ambiguous flags cannot downgrade a real-device review into a fixture check', () => {
  rejected(run(fixture, ['--expected-commit', sha, '--allow-fixture']), /must be separate/);
  for (const args of [['--expected-commit'], ['--expected-commit', 'main'], ['--allow-fixture', '--allow-fixture'], ['--unknown']]) {
    const result = run(fixture, args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
  }
});
