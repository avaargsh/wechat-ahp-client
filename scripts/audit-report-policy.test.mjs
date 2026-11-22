import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptsLowSeverityAuditExit } from './audit-report-policy.mjs';

function report(counts = { info: 0, low: 4, moderate: 17, high: 0, critical: 0 }) {
  const advisories = {};
  let id = 0;
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    for (let i = 0; i < counts[severity]; i++) {
      advisories[`local-test-${id++}`] = { severity, module_name: 'synthetic-module' };
    }
  }
  return { advisories, metadata: { vulnerabilities: { ...counts } } };
}
const attempt = (overrides = {}) => ({ status: 1, signal: null, stderr: '', ...overrides });

test('complete low/moderate-only report with pnpm exit 1 is below the High gate', () => {
  assert.equal(acceptsLowSeverityAuditExit(attempt(), report()), true);
});

test('HIGH and CRITICAL are never considered a benign pnpm exit', () => {
  assert.equal(acceptsLowSeverityAuditExit(attempt(), report({ info: 0, low: 1, moderate: 1, high: 1, critical: 0 })), false);
  assert.equal(acceptsLowSeverityAuditExit(attempt(), report({ info: 0, low: 1, moderate: 0, high: 0, critical: 1 })), false);
});

test('reject missing, inconsistent and partial vulnerability metadata', () => {
  const r = report();
  assert.equal(acceptsLowSeverityAuditExit(attempt(), { advisories: r.advisories }), false);
  assert.equal(acceptsLowSeverityAuditExit(attempt(), { advisories: r.advisories, metadata: { vulnerabilities: { low: 4 } } }), false);
  assert.equal(acceptsLowSeverityAuditExit(attempt(), { ...r, metadata: { vulnerabilities: { ...r.metadata.vulnerabilities, high: 1 } } }), false);
  assert.equal(acceptsLowSeverityAuditExit(attempt(), { ...r, advisories: { item: { severity: 'unknown' } } }), false);
  assert.equal(acceptsLowSeverityAuditExit(attempt(), { ...r, error: { code: 'E_REGISTRY' } }), false);
  assert.equal(acceptsLowSeverityAuditExit(attempt(), { ...r, advisories: null }), false);
});

test('reject pnpm execution errors, unexpected exits and zero-finding failures', () => {
  assert.equal(acceptsLowSeverityAuditExit(attempt({ status: 2 }), report()), false);
  assert.equal(acceptsLowSeverityAuditExit(attempt({ status: null }), report()), false);
  assert.equal(acceptsLowSeverityAuditExit(attempt({ signal: 'SIGKILL' }), report()), false);
  assert.equal(acceptsLowSeverityAuditExit(attempt({ stderr: 'ERR_PNPM_FETCH_500' }), report()), false);
  assert.equal(acceptsLowSeverityAuditExit(attempt(), report({ info: 0, low: 0, moderate: 0, high: 0, critical: 0 })), false);
});
