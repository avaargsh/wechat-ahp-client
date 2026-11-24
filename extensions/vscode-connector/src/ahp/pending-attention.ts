import type { AttentionProjection } from '@wechat-ahp/protocol';

export interface PendingApprovalEntry {
  attention: AttentionProjection;
  turnId: string;
  toolCallId: string;
}

function attentionContentKey(attention: AttentionProjection): string {
  return JSON.stringify([
    attention.id,
    attention.machineId,
    attention.sessionId,
    attention.resourceUri,
    attention.kind,
    attention.projectName ?? null,
    attention.title,
    attention.summary,
    attention.cwd ?? null,
    attention.impact ?? [],
  ]);
}

/**
 * Preserve the current projection for unrelated Host events. When the same
 * pending tool call changes its reviewed content, publish a new monotonic
 * version so Relay preflight and the mobile decision fence can detect it.
 */
export function reconcilePendingAttention(
  previous: AttentionProjection | undefined,
  candidate: AttentionProjection,
  sequence: number,
): AttentionProjection {
  if (!previous) return candidate;
  if (attentionContentKey(previous) === attentionContentKey(candidate)) return previous;

  return {
    ...candidate,
    version: Math.max(previous.version + 1, sequence),
  };
}

/**
 * Re-read Host state before dispatch, then require the same pending version.
 * The caller owns the authoritative refresh and current-entry lookup.
 */
export async function refreshPendingApproval<T extends PendingApprovalEntry>(
  expectedVersion: number,
  refresh: () => Promise<void>,
  getCurrent: () => T | undefined,
): Promise<T> {
  await refresh();
  const current = getCurrent();
  if (!current) {
    throw Object.assign(new Error('approval is no longer pending'), {
      code: 'not_pending' as const,
    });
  }
  if (current.attention.version !== expectedVersion) {
    throw Object.assign(new Error('approval changed; refresh before deciding'), {
      code: 'version_conflict' as const,
    });
  }
  return current;
}
