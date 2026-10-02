import type { AttentionProjection, AttentionState } from '@wechat-ahp/protocol';

export class AttentionStore {
  private readonly items = new Map<string, AttentionProjection>();

  get size(): number {
    return this.items.size;
  }

  get(id: string): AttentionProjection | undefined {
    return this.items.get(id);
  }

  list(state?: AttentionState): AttentionProjection[] {
    return [...this.items.values()]
      .filter(item => !state || item.state === state)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  }

  upsert(attention: AttentionProjection): AttentionProjection {
    const existing = this.items.get(attention.id);
    if (existing && attention.version < existing.version) return existing;

    // A stale equal-version pending projection must never reopen an approval
    // that this relay has already observed as terminal.
    if (
      existing &&
      attention.version === existing.version &&
      existing.state !== 'pending' &&
      attention.state === 'pending'
    ) {
      return existing;
    }

    this.items.set(attention.id, attention);
    return attention;
  }

  /**
   * Reconcile one machine against the connector's authoritative set of current
   * pending approvals. Anything previously pending but absent from the snapshot
   * is closed as resolved_elsewhere rather than being left stale in the inbox.
   */
  reconcile(
    machineId: string,
    authoritative: AttentionProjection[],
    now = new Date().toISOString(),
  ): AttentionProjection[] {
    const seen = new Set<string>();
    const changed: AttentionProjection[] = [];

    for (const attention of authoritative) {
      if (attention.machineId !== machineId) {
        throw new Error('snapshot contains attention from another machine');
      }
      if (attention.state !== 'pending') {
        throw new Error('snapshot may only contain pending attention');
      }

      seen.add(attention.id);
      const before = this.items.get(attention.id);
      const after = this.upsert(attention);
      if (before !== after) changed.push(after);
    }

    for (const current of [...this.items.values()]) {
      if (
        current.machineId !== machineId ||
        current.state !== 'pending' ||
        seen.has(current.id)
      ) continue;

      const closed: AttentionProjection = {
        ...current,
        state: 'resolved_elsewhere',
        version: current.version + 1,
        resolvedAt: now,
      };
      this.items.set(closed.id, closed);
      changed.push(closed);
    }

    return changed;
  }
}
