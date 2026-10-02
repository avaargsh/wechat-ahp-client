export interface ResolutionAttempt {
  decision: string;
  expectedVersion: number;
}

interface ActiveResolution<T> extends ResolutionAttempt {
  promise: Promise<T>;
}

export class ResolutionGate<T> {
  private readonly active = new Map<string, ActiveResolution<T>>();

  run(
    attentionId: string,
    attempt: ResolutionAttempt,
    execute: () => Promise<T>,
  ): Promise<T> {
    const current = this.active.get(attentionId);

    if (current) {
      if (
        current.decision === attempt.decision &&
        current.expectedVersion === attempt.expectedVersion
      ) {
        return current.promise;
      }

      return Promise.reject(
        Object.assign(new Error('another resolution is already in progress'), {
          code: 'resolution_in_progress' as const,
        }),
      );
    }

    const operation = Promise.resolve().then(execute);
    const promise = operation.finally(() => {
      if (this.active.get(attentionId)?.promise === promise) {
        this.active.delete(attentionId);
      }
    });

    this.active.set(attentionId, {
      ...attempt,
      promise,
    });

    return promise;
  }
}
