#!/usr/bin/env node
import fs from 'node:fs';

function fail(message) {
  console.error(`real-device acceptance violation: ${message}`);
  process.exit(2);
}

const [path, ...args] = process.argv.slice(2);
const usage = 'usage: node scripts/verify-real-device-acceptance.mjs <evidence.json> '
  + '(--expected-commit <tested SHA> | --allow-fixture)';
if (!path || path.startsWith('--')) fail(usage);

let allowFixture = false;
let expectedCommit;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--allow-fixture' && !allowFixture) {
    allowFixture = true;
  } else if (args[index] === '--expected-commit' && expectedCommit === undefined) {
    expectedCommit = args[++index];
    if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) fail('expected commit must be a full Git SHA');
  } else {
    fail(usage);
  }
}
if (allowFixture && expectedCommit) fail('fixture checks and real-device review must be separate');

let doc;
try {
  const raw = fs.readFileSync(path, 'utf8');
  if (raw.includes('CHANGE-ME')) fail('evidence still contains CHANGE-ME placeholders');
  doc = JSON.parse(raw);
} catch {
  // Do not echo file contents or parser fragments into CI logs.
  fail('cannot read a valid evidence JSON file');
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
}
object(doc, 'evidence');
if (doc.schemaVersion !== 2 || doc.kind !== 'WeChatAHPRealDeviceAcceptance') {
  fail('unsupported evidence contract; use the v2 template');
}
if (doc.mode !== (allowFixture ? 'contract-fixture' : 'real-device')) {
  fail(allowFixture ? '--allow-fixture accepts contract-fixture only' : 'real-device evidence required; fixtures need --allow-fixture');
}
if (!allowFixture && !expectedCommit) fail('real-device review requires --expected-commit');

for (const name of ['source', 'host', 'pairing', 'attention', 'notification', 'decision', 'negativeControls']) {
  object(doc[name], name);
}

const requiredTrue = [
  'source.cleanWorktree',
  'pairing.qrClaimed',
  'pairing.wechatLinked',
  'attention.pendingVisible',
  'notification.consentAccepted',
  'notification.deepLinkOpenedSameAttention',
  'decision.authoritativePreflight',
  'decision.hostAckObserved',
  'decision.terminalProjectionObserved',
  'decision.originalSessionOutcomeObserved',
  'negativeControls.offlineFailsClosed',
  'negativeControls.staleFailsClosed',
  'negativeControls.conflictingDecisionFailsClosed',
  'negativeControls.duplicateDecisionCoalesces',
];
for (const name of requiredTrue) {
  const [section, field] = name.split('.');
  if (doc[section][field] !== true) fail(`${name} must be true`);
}

if (typeof doc.source.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(doc.source.commitSha)) {
  fail('source.commitSha must be a full Git SHA');
}
if (expectedCommit && doc.source.commitSha !== expectedCommit) {
  fail('source.commitSha does not match the build under review');
}
if (!['allow_once', 'reject'].includes(doc.decision.value)) {
  fail('decision.value must be allow_once or reject');
}
for (const name of ['attention.opaqueId', 'host.machineId', 'host.agentHost']) {
  const [section, field] = name.split('.');
  if (typeof doc[section][field] !== 'string' || !doc[section][field].trim()) fail(`${name} is required`);
}
if (doc.notification.deepLinkAttentionId !== doc.attention.opaqueId) {
  fail('notification deep link must target the same opaque Attention id');
}
const timestamp = doc.recordedAt;
if (typeof timestamp !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)
    || Number.isNaN(Date.parse(timestamp))
    || new Date(timestamp).toISOString() !== (timestamp.includes('.') ? timestamp : timestamp.replace('Z', '.000Z'))) {
  fail('recordedAt must be a valid UTC ISO timestamp');
}

const forbiddenKeys = new Set([
  'connectortoken', 'mobiletoken', 'sessionkey', 'appsecret', 'accesstoken',
  'commandtext', 'toolinput', 'repositorypath',
]);
function walk(value) {
  if (Array.isArray(value)) return value.forEach(walk);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
      fail('forbidden sensitive field present');
    }
    walk(child);
  }
}
walk(doc);

console.log(JSON.stringify({
  contractVerified: true,
  kind: doc.kind,
  mode: doc.mode,
  sourceCommit: doc.source.commitSha,
  recordedAt: doc.recordedAt,
  decision: doc.decision.value,
  eligibleForRealDeviceReview: !allowFixture,
  observationBasis: allowFixture ? 'synthetic' : 'operator-recorded',
  liveExecutionVerified: false,
}, null, 2));
