import { randomBytes, randomUUID } from 'node:crypto';
import type { MobileSession, PairingTicket } from '@wechat-ahp/protocol';

interface PairingRecord extends PairingTicket {
  expiresAtMs: number;
}

interface SessionRecord extends MobileSession {
  expiresAtMs: number;
}

export class PairingStore {
  private readonly pairings = new Map<string, PairingRecord>();
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly pairingTtlMs = 5 * 60_000,
    private readonly sessionTtlMs = 30 * 24 * 60 * 60_000,
  ) {}

  create(machineId: string, now = Date.now()): PairingTicket {
    this.cleanup(now);

    let code: string;
    do {
      code = randomBytes(5).toString('hex').toUpperCase();
    } while (this.pairings.has(code));

    const expiresAtMs = now + this.pairingTtlMs;
    const ticket: PairingRecord = {
      pairingId: randomUUID(),
      code,
      machineId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
    };
    this.pairings.set(code, ticket);

    return this.publicTicket(ticket);
  }

  claim(
    rawCode: string,
    deviceName = 'WeChat Mini Program',
    now = Date.now(),
  ): MobileSession | undefined {
    this.cleanup(now);

    const code = rawCode.trim().toUpperCase();
    const pairing = this.pairings.get(code);
    if (!pairing || pairing.expiresAtMs <= now) return;

    // Pairing codes are strictly one-time.
    this.pairings.delete(code);

    const token = randomBytes(32).toString('base64url');
    const expiresAtMs = now + this.sessionTtlMs;
    const session: SessionRecord = {
      token,
      machineId: pairing.machineId,
      deviceName: deviceName.trim().slice(0, 80) || 'WeChat Mini Program',
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
    };
    this.sessions.set(token, session);

    return this.publicSession(session);
  }

  authorize(token: string | undefined, now = Date.now()): MobileSession | undefined {
    if (!token) return;
    const session = this.sessions.get(token);
    if (!session) return;

    if (session.expiresAtMs <= now) {
      this.sessions.delete(token);
      return;
    }

    return this.publicSession(session);
  }

  private cleanup(now: number): void {
    for (const [code, pairing] of this.pairings) {
      if (pairing.expiresAtMs <= now) this.pairings.delete(code);
    }
    for (const [token, session] of this.sessions) {
      if (session.expiresAtMs <= now) this.sessions.delete(token);
    }
  }

  private publicTicket(record: PairingRecord): PairingTicket {
    const { expiresAtMs: _ignored, ...ticket } = record;
    return ticket;
  }

  private publicSession(record: SessionRecord): MobileSession {
    const { expiresAtMs: _ignored, ...session } = record;
    return session;
  }
}
