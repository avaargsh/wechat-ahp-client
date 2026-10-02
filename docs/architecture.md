# Architecture

## Product boundary

The Mini Program is an **attention surface**, not a second IDE.

```text
WeChat Mini Program
  └─ inbox / approval detail
        │ HTTPS
        ▼
Thin Relay
  └─ auth / pairing / routing / notification projection
        │ WSS
        ▼
VS Code Connector
  └─ local Agent Host discovery / AHP subscription / action dispatch
        │ local AHP
        ▼
VS Code Agent Host
  └─ sessions / chats / tool calls / authority
        │
        ▼
Codex
```

## Authority boundary

- **Agent Host is authoritative** for whether an approval exists and whether it is still pending.
- Relay stores only an `AttentionProjection`.
- A phone action is not successful until the connector receives Host acknowledgement.
- Offline approval is forbidden.
- Duplicate resolve requests are idempotent.

## Transport MVP

The first implementation deliberately uses a demo approval emitted by the VS Code extension:

```text
VS Code command
→ connector attention.upsert
→ relay projection
→ Mini Program detail
→ POST /resolve
→ relay approval.resolve
→ connector ack
→ relay resolved projection
```

This stabilizes transport and mobile UX before wiring real AHP semantics.

## AHP seam

The connector is the only layer that should understand AHP:

```text
ToolCall pending-confirmation
→ AttentionProjection

allow_once
→ chat/toolCallConfirmed { approved: true, confirmed: "user-action" }

reject
→ chat/toolCallConfirmed { approved: false, reason: "denied" }
```

The relay routes envelopes but does not interpret Agent Host state.
