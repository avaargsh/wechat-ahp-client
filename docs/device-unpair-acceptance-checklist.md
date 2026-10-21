# Device unpair acceptance checklist

Status: **NOT RUN** until an operator completes this checklist on a real WeChat Mini Program and a live Relay. This document is a recording aid, not evidence that any check passed.

## Run metadata

Fill in only after the run. Do not paste tokens, session keys, AppSecrets, OpenIDs, QR payloads, full URLs with credentials, source code, commands, or repository paths.

- Run date/time (timezone):
- Operator:
- Tested full Git SHA:
- Relay deployment/version:
- WeChat device/platform:
- Network conditions:
- Result: `NOT RUN` / `PASS` / `FAIL`
- Evidence reviewed by:

## Preconditions

- [ ] Build and deploy the Mini Program from the recorded clean Git SHA.
- [ ] Use real WeChat identity verification (`WX_APPID` and `WX_APP_SECRET` configured); do not use the legacy `MOBILE_TOKEN` development bypass.
- [ ] Connect a real VS Code Connector / Agent Host session.
- [ ] Pair two independent devices to the same machine; record only neutral labels such as Device A and Device B.
- [ ] Confirm both devices can access their own paired session before testing.
- [ ] Prepare a safe pending approval that can be rejected or allowed without exposing sensitive command or source content in the evidence.

## Test matrix

For every row, record `PASS`, `FAIL`, or `NOT RUN`, plus a short sanitized observation. Do not mark a test PASS based on code inspection or CI fixtures.

| ID | Action | Expected result | Status | Sanitized observation |
|---|---|---|---|---|
| U1 | On Device A, choose **解除本机绑定** and confirm. | Relay confirms revocation; UI reports success only after a confirmed response. | NOT RUN | |
| U2 | Use Device A's old paired session after U1. | Protected session endpoint returns HTTP 401. | NOT RUN | |
| U3 | Attempt unpair again with Device A's old token. | HTTP 401; no other session is affected. | NOT RUN | |
| U4 | Use Device B's paired session after U1. | Device B remains authorized (HTTP 200 on its session endpoint). | NOT RUN | |
| U5 | Attempt unpair with the legacy development bearer, if the negative control can be safely exercised. | HTTP 403; it cannot revoke a paired session. Never use this mode for real-device acceptance. | NOT RUN | |
| U6 | Make Relay unreachable during an unpair attempt on Device B or a disposable test pairing. Restore connectivity and retry. | UI does not claim success or clear the token on an ambiguous network failure; it retains the token and allows retry. After a confirmed revocation, the token is cleared. | NOT RUN | |
| U7 | Keep a safe pending approval visible while revoking Device A. Observe the original VS Code/Agent Host session. | Revocation blocks future requests from Device A; it is not represented as cancellation of an already-authorized/in-flight Host action. Native Host remains the authority. | NOT RUN | |
| U8 | Restart Relay after revocation, then retry Device A's old token and Device B's session. | With the current in-memory session store, sessions are lost on restart; both old tokens should be unauthorized. Record this limitation explicitly, not as durable revocation. | NOT RUN | |

## Evidence and privacy

- Record HTTP status codes and UI outcomes only; do not retain bearer tokens or request headers.
- Do not copy command text, tool input, repository paths, session titles, source code, WeChat session keys, OpenIDs, or secrets into this file or PR.
- If any expected result differs, mark the row FAIL and open a focused bug report. Do not silently edit expected results to match observed behavior.
- A passing result is operator-recorded evidence. It is not independently attested by this checklist or by the CI fixture.

## Exit criteria

Device-unpair acceptance is complete only when U1–U4 and U6 are observed on the real device with a live Relay, U7 is explicitly reviewed, and the record is bound to the exact tested Git SHA. U5 and U8 are negative/limitation controls and must be recorded as PASS, FAIL, or NOT RUN; they must not be silently omitted.

The current relay keeps paired sessions in memory. Relay restart invalidates sessions, so U8 documents current behavior rather than a promise of persistent session management.
