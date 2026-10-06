## Summary

<!-- What user-visible or protocol behavior changes? -->

## Golden-path impact

- [ ] Notification / deep-link entry
- [ ] Pending attention list/detail
- [ ] Allow Once / Reject
- [ ] Host continuation / desktop convergence
- [ ] WeChat login / Bearer session
- [ ] Relay / connector protocol
- [ ] Mini Program UX only
- [ ] No golden-path behavior change

## Source-of-truth / security checks

- [ ] VS Code Agent Host remains the source of truth; relay state is only a projection.
- [ ] Stale or already-resolved attention is handled safely.
- [ ] No credentials, session secrets, private endpoints, or user content are added to the repository.
- [ ] A mobile action cannot silently widen approval scope beyond the displayed action.

## Validation

Commands run:

```text
pnpm typecheck
pnpm test
pnpm build
# include real-device / Host E2E evidence when the changed path requires it
```

Results / evidence:

```text
# paste concise results
```

## UI evidence

<!-- For Mini Program UI changes: affected pages, screenshots/video reference, device/runtime used. Otherwise "N/A". -->

## Risk and rollback

<!-- Include protocol compatibility and mobile/desktop convergence risks. -->
