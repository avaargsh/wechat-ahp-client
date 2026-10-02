# wechat-ahp-client

A WeChat Mini Program remote for VS Code Agent Host.

The first milestone is intentionally narrow: when Codex is waiting on an approval, notify the user in WeChat, deep-link into the Mini Program, show the latest authoritative approval state, and let the user choose **Allow Once** or **Reject**. VS Code Agent Host remains the source of truth.

## Architecture

```text
VS Code + Codex
      │
      ▼
VS Code Agent Host (AHP)
      │ local AHP
      ▼
VS Code Connector
      │ outbound WSS
      ▼
Thin Relay
      │ HTTPS/WSS + WeChat subscribe message
      ▼
WeChat Mini Program
```

## MVP golden slice

```text
Codex approval pending
→ Connector observes AHP state
→ Relay projects Attention
→ WeChat notification wakes the user
→ Mini Program opens approval detail
→ Refresh latest host state
→ Allow Once / Reject
→ Host confirms
→ Codex continues
```

## Non-goals for MVP

No mobile IDE, no Monaco editor, no independent agent runtime, no copied session database, no automatic approval, no terminal emulation, no Git implementation.

See `docs/architecture.md` for the planned boundaries.
