# Security

## Invariants

1. No public inbound port on the development machine.
2. Relay never stores repo contents, Codex credentials, SSH keys, or Agent Host connection tokens.
3. Deep links carry opaque attention IDs only.
4. WeChat notification text must not contain full commands, source code, secrets, or full local paths.
5. Approval requires a live authoritative Host check; no offline approval queue.
6. Resolve is idempotent and version-checked.
7. The default decision surface exposes only **Allow Once** and **Reject**.

## Transport MVP authentication

The first slice uses explicit development tokens:

- `CONNECTOR_TOKEN` authenticates the VS Code connector.
- `MOBILE_TOKEN` authenticates Mini Program API requests.

Production replaces the mobile token with `wx.login` / `code2Session`, owner allow-listing, device binding, and short-lived sessions.

## Fail closed

If the connector is offline, the relay cannot confirm current Host state. Approval therefore fails rather than being queued for later execution.
