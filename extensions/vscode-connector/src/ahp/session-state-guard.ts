import type { SessionState } from '@microsoft/agent-host-protocol';

/**
 * Reject an AHP EmptyState or a malformed snapshot before consumers enumerate
 * its session chat catalog. The AHP subscribe result is not session-only: other
 * channels may carry the empty object or a different state shape.
 *
 * This checks the mandatory fields used to discriminate SessionState; it is not
 * an authentication or comprehensive wire-schema validator.
 */
export function isSessionState(value: unknown): value is SessionState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const state = value as Record<string, unknown>;
  if (
    typeof state.provider !== 'string' ||
    typeof state.title !== 'string' ||
    typeof state.status !== 'number' ||
    !Number.isFinite(state.status) ||
    (state.lifecycle !== 'creating' &&
      state.lifecycle !== 'ready' &&
      state.lifecycle !== 'failed') ||
    !Array.isArray(state.chats) ||
    !Array.isArray(state.activeClients)
  ) {
    return false;
  }

  return state.chats.every((chat: unknown) => {
    if (chat === null || typeof chat !== 'object' || Array.isArray(chat)) {
      return false;
    }
    const resource = (chat as Record<string, unknown>).resource;
    return typeof resource === 'string' && resource.length > 0;
  });
}
