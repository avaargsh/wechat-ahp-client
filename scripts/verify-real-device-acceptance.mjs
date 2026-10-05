#!/usr/bin/env node
import fs from "node:fs"

function fail(message) {
  console.error(`real-device acceptance violation: ${message}`)
  process.exit(2)
}

const path = process.argv[2]
if (!path) {
  fail("usage: node scripts/verify-real-device-acceptance.mjs <evidence.json>")
}

const raw = fs.readFileSync(path, "utf8")
if (raw.includes("CHANGE-ME")) {
  fail("evidence still contains CHANGE-ME placeholders")
}

const doc = JSON.parse(raw)
if (doc.schemaVersion !== 1 || doc.kind !== "WeChatAHPRealDeviceAcceptance") {
  fail("unsupported evidence contract")
}
if (doc.mode !== "real-device") {
  fail("mode must be real-device")
}

const requiredTrue = {
  "pairing.qrClaimed": doc.pairing?.qrClaimed,
  "pairing.wechatLinked": doc.pairing?.wechatLinked,
  "attention.pendingVisible": doc.attention?.pendingVisible,
  "notification.consentAccepted": doc.notification?.consentAccepted,
  "notification.deepLinkOpenedSameAttention": doc.notification?.deepLinkOpenedSameAttention,
  "decision.authoritativePreflight": doc.decision?.authoritativePreflight,
  "decision.hostAckObserved": doc.decision?.hostAckObserved,
  "decision.terminalProjectionObserved": doc.decision?.terminalProjectionObserved,
  "negativeControls.offlineFailsClosed": doc.negativeControls?.offlineFailsClosed,
  "negativeControls.staleFailsClosed": doc.negativeControls?.staleFailsClosed,
  "negativeControls.conflictingDecisionFailsClosed": doc.negativeControls?.conflictingDecisionFailsClosed,
}
for (const [name, value] of Object.entries(requiredTrue)) {
  if (value !== true) fail(`${name} must be true`)
}

if (!["allow_once", "reject"].includes(doc.decision?.value)) {
  fail("decision.value must be allow_once or reject")
}
if (typeof doc.attention?.opaqueId !== "string" || !doc.attention.opaqueId) {
  fail("attention.opaqueId is required")
}
if (doc.notification?.deepLinkAttentionId !== doc.attention.opaqueId) {
  fail("notification deep link must target the same opaque Attention id")
}
if (typeof doc.host?.machineId !== "string" || !doc.host.machineId) {
  fail("host.machineId is required")
}
if (typeof doc.host?.agentHost !== "string" || !doc.host.agentHost) {
  fail("host.agentHost is required")
}
if (typeof doc.recordedAt !== "string" || Number.isNaN(Date.parse(doc.recordedAt))) {
  fail("recordedAt must be an ISO timestamp")
}

const forbiddenKeys = new Set([
  "connectorToken",
  "mobileToken",
  "sessionKey",
  "appSecret",
  "accessToken",
  "commandText",
  "toolInput",
  "repositoryPath",
])
function walk(value, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...trail, String(index)]))
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) {
      fail(`forbidden sensitive field present: ${[...trail, key].join(".")}`)
    }
    walk(child, [...trail, key])
  }
}
walk(doc)

console.log(JSON.stringify({
  verified: true,
  kind: doc.kind,
  recordedAt: doc.recordedAt,
  machineId: doc.host.machineId,
  decision: doc.decision.value,
  attentionId: doc.attention.opaqueId,
}, null, 2))
