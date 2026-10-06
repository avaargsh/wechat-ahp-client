# Contributing

This repository optimizes for one narrow product loop:

```text
notification -> open pending attention -> inspect action
-> Allow Once | Reject -> same Host session continues
```

Keep changes small and preserve the following boundaries:

- VS Code Agent Host is the source of truth.
- Relay records are projections for routing and mobile presentation.
- Mobile approval must never widen the action or scope the user was shown.
- Protocol compatibility and desktop/mobile convergence matter more than local UI convenience.
- Do not commit credentials, WeChat secrets, bearer tokens, private endpoints, captured user content, or production identifiers.

## Development checks

Before opening a pull request, run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

For real-device, login, deep-link, subscription-message, or Host continuation changes, attach the corresponding real-device / Host E2E evidence. A unit-test-only result is not enough to claim the mobile golden path works.

## Pull requests

Use the repository PR template. Keep refactors separate from behavior changes unless the behavior change requires the refactor.

For UI changes, state the affected pages and the device/runtime used for verification. For protocol changes, describe compatibility, stale-state handling, and failure behavior.
