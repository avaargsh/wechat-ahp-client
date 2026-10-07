import type {
  AttentionProjection,
  ResolveAttentionInput,
  ResolveDecision,
} from '@wechat-ahp/protocol';

interface ApprovalClient {
  read(id: string): Promise<AttentionProjection>;
  resolve(id: string, input: ResolveAttentionInput): Promise<AttentionProjection>;
  onDispatch?(): void;
}

type ApprovalResult = {
  status: 'changed' | 'already_resolved' | 'resolved';
  attention: AttentionProjection;
};

// Bind the decision to the identity and content the user actually inspected.
// A timestamp-only refresh is harmless; a new version or changed scope requires
// another explicit decision even if the relay still reports "pending".
function reviewedContent(attention: AttentionProjection): string {
  return JSON.stringify([
    attention.id,
    attention.machineId,
    attention.sessionId,
    attention.resourceUri,
    attention.version,
    attention.kind,
    attention.projectName,
    attention.title,
    attention.summary,
    attention.cwd,
    attention.impact ?? [],
  ]);
}

export async function submitReviewedApproval(
  displayed: AttentionProjection,
  decision: ResolveDecision,
  client: ApprovalClient,
): Promise<ApprovalResult> {
  if (displayed.state !== 'pending') {
    return { status: 'already_resolved', attention: displayed };
  }

  const latest = await client.read(displayed.id);
  if (latest.state !== 'pending') {
    return { status: 'already_resolved', attention: latest };
  }
  if (reviewedContent(latest) !== reviewedContent(displayed)) {
    return { status: 'changed', attention: latest };
  }

  client.onDispatch?.();
  const attention = await client.resolve(displayed.id, {
    decision,
    expectedVersion: displayed.version,
  });
  return { status: 'resolved', attention };
}
