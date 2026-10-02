# Security

## Invariants

1. No public inbound port on the development machine.
2. Relay never stores repo contents, Codex credentials, SSH keys, or Agent Host connection tokens.
3. Deep links carry opaque attention IDs only.
4. WeChat notification text must not contain full commands, source code, secrets, or full local paths.
5. Approval requires a live authoritative Host check; no offline approval queue.
6. Resolve is idempotent and version-checked.
7. The default decision surface exposes only **Allow Once** and **Reject**.
8. A paired mobile session is scoped to exactly one `machineId`.

## Connector authentication

`CONNECTOR_TOKEN` authenticates the outbound VS Code connector to the relay. It is sent in the WebSocket Authorization header, never in a URL.

## Mobile device pairing

The normal mobile flow no longer depends on a shared default bearer token.

1. The authenticated VS Code connector asks the relay for a pairing ticket.
2. Relay issues a random one-time code with a 5-minute TTL.
3. The Mini Program claims the code once.
4. Relay exchanges it for a random 256-bit mobile session token.
5. The mobile session is scoped to the machine that created the pairing ticket.
6. Attention list/detail/resolve endpoints enforce that machine scope.

Pairing codes are deleted after a successful claim. Mobile sessions currently live in relay memory and therefore intentionally expire on relay restart; persistence is a later hardening step.

## WeChat identity binding

When `WX_APPID` and `WX_APP_SECRET` are configured together, pairing also requires a fresh `wx.login()` code. The relay exchanges that temporary code with WeChat's server-side code2Session endpoint and binds the resulting OpenID to the relay-side mobile session.

- `session_key` is never sent to the Mini Program.
- OpenID is not returned in the mobile session response.
- the Mini Program only sees `wechatLinked: true`.
- if WeChat verification fails, pairing fails closed and no mobile session is issued.

When both WeChat credentials are absent, identity verification is disabled so tourist/local development remains possible.

For transitional local development only, setting `MOBILE_TOKEN` enables the old unscoped bearer-token path. There is no default `dev-mobile` fallback anymore.

## Fail closed

If the connector is offline, the relay cannot confirm current Host state. Approval therefore fails rather than being queued for later execution.
