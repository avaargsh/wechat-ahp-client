export type AttentionKind =
  | 'command'
  | 'file_write'
  | 'network'
  | 'permission'
  | 'question';

export type AttentionState =
  | 'pending'
  | 'resolved_allow'
  | 'resolved_reject'
  | 'resolved_elsewhere'
  | 'cancelled'
  | 'expired';

export type ResolveDecision = 'allow_once' | 'reject';

export interface PairingTicket {
  pairingId: string;
  code: string;
  machineId: string;
  expiresAt: string;
}

export interface PairingClaimInput {
  code: string;
  deviceName?: string;
  wechatCode?: string;
}

export interface MobileSession {
  token: string;
  machineId: string;
  deviceName: string;
  expiresAt: string;
  wechatLinked?: boolean;
}

export interface AttentionProjection {
  id: string;
  machineId: string;
  sessionId: string;
  resourceUri: string;
  kind: AttentionKind;
  projectName?: string;
  title: string;
  summary: string;
  cwd?: string;
  impact?: string[];
  state: AttentionState;
  version: number;
  observedAt: string;
  resolvedAt?: string;
}

export type ConnectorToRelay =
  | {
      type: 'connector.hello';
      machineId: string;
      displayName: string;
      version: string;
    }
  | {
      type: 'pairing.create';
      requestId: string;
      machineId: string;
    }
  | {
      type: 'attention.snapshot';
      machineId: string;
      attentions: AttentionProjection[];
    }
  | {
      type: 'attention.upsert';
      attention: AttentionProjection;
    }
  | {
      type: 'attention.resolved';
      attention: AttentionProjection;
    }
  | {
      type: 'approval.resolve.result';
      requestId: string;
      ok: true;
      attention: AttentionProjection;
    }
  | {
      type: 'approval.resolve.result';
      requestId: string;
      ok: false;
      error: string;
      attention?: AttentionProjection;
    };

export type RelayToConnector =
  | {
      type: 'pairing.create.result';
      requestId: string;
      ok: true;
      ticket: PairingTicket;
    }
  | {
      type: 'pairing.create.result';
      requestId: string;
      ok: false;
      error: string;
    }
  | {
      type: 'approval.resolve';
      requestId: string;
      attentionId: string;
      expectedVersion: number;
      decision: ResolveDecision;
    };

export interface ResolveAttentionInput {
  decision: ResolveDecision;
  expectedVersion: number;
}

export interface ApiError {
  error: string;
  code:
    | 'not_found'
    | 'not_pending'
    | 'version_conflict'
    | 'machine_offline'
    | 'connector_timeout'
    | 'unauthorized'
    | 'bad_request';
}
