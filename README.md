# wechat-ahp-client

A **Codex-first, AHP-native WeChat Mini Program remote** for VS Code Agent Host.

The project starts with one narrow golden slice: when Codex is blocked on a tool approval, the phone surfaces the pending action, lets the user choose **Allow Once** or **Reject**, and the same VS Code/Codex session continues.

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
      │ HTTPS
      ▼
WeChat Mini Program
```

**Authority rule:** VS Code Agent Host is the source of truth. Relay attention records are projections used for routing and mobile presentation only.

## Implemented in the first slice

- pnpm + TypeScript monorepo
- local VS Code Agent Host discovery
- AHP 0.9 chat/session selection
- subscription to the selected AHP chat
- mapping of `pending-confirmation` / `pending-result-confirmation` tool calls to mobile Attention
- dispatch of `chat/toolCallConfirmed` for Allow Once / Reject
- outbound WebSocket connector with reconnect
- authenticated thin relay with version-checked resolve requests
- Taro/React Mini Program inbox and approval detail UI
- resolved-elsewhere projection when the approval disappears on another client

## Local development

```bash
pnpm install
pnpm build

# Relay
MOBILE_TOKEN=dev-mobile \
CONNECTOR_TOKEN=dev-connector \
pnpm --filter @wechat-ahp/relay dev
```

Run the VS Code extension in an Extension Development Host, configure:

```text
wechatAhp.relayUrl = ws://127.0.0.1:8787/connector
wechatAhp.connectorToken = dev-connector
wechatAhp.machineId = devbox
```

Then open an Agent Host/Codex chat and run:

```text
WeChat AHP Client: Select Agent Host Chat
```

For Mini Program development, set the relay HTTP origin in
`apps/miniprogram/src/config.ts`. The preferred flow is VS Code one-time pairing.
For a real Mini Program identity, configure `WX_APPID` and `WX_APP_SECRET` on
the relay; local tourist builds can leave both unset.

## Still intentionally missing

The next slice is **WeChat wake-up**, not more IDE surface:

1. `wx.login` / `code2Session`
2. QR device pairing
3. subscription-message opt-in
4. safe notification projection
5. deep-link into the approval detail
6. reconciliation/persistence so a relay restart can rebuild pending Attention

Session timeline, changesets/diff, terminal, and CCC-style navigation come after the Attention loop is proven.

## Non-goals

No Monaco, no second agent runtime, no copied Codex thread database, no auto-approve, and no Git/PTY reimplementation.

See `docs/architecture.md`, `docs/security.md`, and `docs/roadmap.md`.
