# Real device acceptance

V0.3 is code-complete only after the approval loop is exercised on a **real
WeChat device** against a live VS Code Agent Host. Unit tests and Mini Program
builds do not satisfy this milestone.

## Preconditions

- Relay is reachable over HTTPS/WSS from the phone.
- Relay has real `WX_APPID` and `WX_APP_SECRET`.
- The Mini Program uses the intended subscription-message template.
- VS Code Connector is connected to the relay and a real Agent Host/Codex chat.
- No development `MOBILE_TOKEN` path is used for the acceptance run.

## Golden path

1. In VS Code, create a one-time pairing ticket.
2. Scan the QR code in the real Mini Program.
3. Confirm pairing succeeds only after `wx.login -> code2Session`.
4. Trigger one Codex tool approval and confirm it appears as pending on the phone.
5. Accept one subscription-message request.
6. Allow the relay to send the generic wake-up notification.
7. Open the notification and confirm the deep link lands on the **same opaque
   Attention ID**.
8. Tap **Allow Once** or **Reject**.
9. Confirm the Mini Program performs a fresh authoritative preflight.
10. Confirm success is shown only after the VS Code Connector receives Agent Host
    ACK and the relay publishes terminal state.
11. Confirm the original VS Code/Codex session continues or rejects accordingly.

## Required negative controls

Run these on the same build:

- stop the Connector, attempt a decision, and confirm **offline fails closed**;
- resolve the approval in VS Code first, then act on the stale phone view and
  confirm **stale fails closed + refreshes**;
- issue opposite decisions from two clients and confirm the conflicting path
  **fails closed**;
- retry the same decision and confirm it coalesces rather than dispatching a
  second Host operation.

## Evidence

Copy `acceptance/real-device.template.json` outside the repo, replace the
placeholders with the observed non-sensitive facts, set the required booleans
only after each step was actually observed, then run:

```bash
pnpm test:real-device-contract
node scripts/verify-real-device-acceptance.mjs /path/to/real-device-evidence.json
```

The evidence file intentionally stores no command text, tool input, repository
paths, Connector token, mobile token, WeChat session key, AppSecret, or access
token.

A passing JSON verifier proves that the operator recorded every required
observation. It does **not** replace the actual device/Host run.

## Release decision

Only after a real evidence record passes should the V0.3 roadmap item:

```text
verify end-to-end on a real WeChat device + VS Code Agent Host
```

be checked off.
