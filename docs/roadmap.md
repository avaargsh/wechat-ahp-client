# Roadmap

## V0.1 — Attention transport MVP

- [x] TypeScript monorepo
- [x] outbound connector WebSocket
- [x] authenticated relay API
- [x] attention projection
- [x] idempotent resolve request/ack path
- [x] Mini Program inbox
- [x] Mini Program approval detail
- [x] real AHP tool-call subscription
- [x] dispatch AHP tool-call confirmation
- [x] reconcile pending approvals after relay reconnect/restart

## V0.2 — WeChat wake-up

- [x] wx.login / code2Session
- [x] one-time device pairing code
- [x] QR scan pairing UX
- [x] subscribe-message opt-in
- [x] safe notification projection
- [x] deep-link to approval detail
- [x] in-memory notification send journal

## V0.3 — Reliable approval golden path

- [x] re-fetch authoritative projection immediately before mobile decision
- [x] only show success after Agent Host dispatch ACK
- [x] coalesce identical duplicate resolve requests
- [x] fail closed on conflicting cross-device decisions
- [x] reconcile stale Host state before returning resolve conflict
- [x] prevent equal-version stale pending projection from reopening terminal state
- [ ] verify end-to-end on a real WeChat device + VS Code Agent Host

## V1 — Agent Remote

Session list, read-only timeline, questions/blocked state, completion.

## V1.1 — Review

AHP changesets, changed-file summary, diff viewer, “Ask Codex to revise”.

## Later

Lightweight terminal, multi-host, richer CCC-style navigation.

No Monaco or full mobile IDE unless real usage proves it necessary.
