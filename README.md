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

## Implemented wake-up and remaining acceptance

The code now includes `wx.login` / `code2Session`, one-time QR pairing,
subscription-message opt-in, generic notification text, approval deep links,
and pending-Attention reconstruction from the Connector after relay restart.
Pairing sessions and notification consent/journals remain in memory.

**Real WeChat device + live VS Code Agent Host acceptance is still pending.**
Use [the acceptance runbook](docs/real-device-acceptance.md) to retain observations
bound to the tested commit. CI checks a clearly labelled synthetic contract
fixture; it does not prove notification delivery or Host continuation on a phone.

Session timeline, changesets/diff, terminal, and CCC-style navigation come after the Attention loop is proven.

## Non-goals

No Monaco, no second agent runtime, no copied Codex thread database, no auto-approve, and no Git/PTY reimplementation.

See `docs/architecture.md`, `docs/security.md`, and `docs/roadmap.md`.
