import { randomBytes, randomUUID } from 'node:crypto';
import type { MobileSession, PairingTicket } from '@wechat-ahp/protocol';

interface PairingRecord extends PairingTicket {
  expiresAtMs: number;
}

interface SessionRecord extends MobileSession {
  expiresAtMs: number;
  wechatOpenId?: string;
}

export interface NotificationRecipient {
  sessionToken: string;
  openId: string;
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
    wechatOpenId?: string,
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
      wechatOpenId,
      wechatLinked: Boolean(wechatOpenId),
      notificationsEnabled: false,
    };
    this.sessions.set(token, session);

    return this.publicSession(session);
  }

  authorize(token: string | undefined, now = Date.now()): MobileSession | undefined {
    const session = this.activeSession(token, now);
    return session ? this.publicSession(session) : undefined;
  }

  setNotificationsEnabled(
    token: string | undefined,
    enabled: boolean,
    now = Date.now(),
  ): MobileSession | undefined {
    const session = this.activeSession(token, now);
    if (!session || (enabled && !session.wechatOpenId)) return;

    session.notificationsEnabled = enabled;
    return this.publicSession(session);
  }

  notificationRecipients(
    machineId: string,
    now = Date.now(),
  ): NotificationRecipient[] {
    this.cleanup(now);

    const seen = new Set<string>();
    const result: NotificationRecipient[] = [];

    for (const session of this.sessions.values()) {
      if (
        session.machineId !== machineId ||
        !session.notificationsEnabled ||
        !session.wechatOpenId
      ) continue;

      // A WeChat account may have paired multiple devices. One subscription
      // consent should result in at most one send for the same OpenID.
      if (seen.has(session.wechatOpenId)) continue;
      seen.add(session.wechatOpenId);
      result.push({
        sessionToken: session.token,
        openId: session.wechatOpenId,
      });
    }

    return result;
  }

  private activeSession(
    token: string | undefined,
    now: number,
  ): SessionRecord | undefined {
    if (!token) return;
    const session = this.sessions.get(token);
    if (!session) return;

    if (session.expiresAtMs <= now) {
      this.sessions.delete(token);
      return;
    }

    return session;
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
    const {
      expiresAtMs: _expiresAtMs,
      wechatOpenId: _wechatOpenId,
      ...session
    } = record;
    return session;
  }
}
