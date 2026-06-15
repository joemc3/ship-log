import { createHmac, timingSafeEqual } from 'node:crypto';
import type { UserRole } from './users.js';

export const SESSION_COOKIE = 'slog_session';

export interface Session {
  username: string;
  role: UserRole;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/** Build a signed, stateless session token: `base64url(payload).hmac`. */
export function createToken(session: Session, secret: string, now: Date): string {
  const body = Buffer.from(
    JSON.stringify({ u: session.username, r: session.role, iat: now.getTime() }),
  ).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/** Verify signature, structure, and TTL. Returns the Session or null. */
export function verifyToken(
  token: string | undefined,
  secret: string,
  now: Date,
  ttlMs: number,
): Session | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: { u?: unknown; r?: unknown; iat?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    typeof parsed.u !== 'string' ||
    (parsed.r !== 'owner' && parsed.r !== 'crew') ||
    typeof parsed.iat !== 'number'
  ) {
    return null;
  }
  if (parsed.iat > now.getTime()) return null;          // reject future-dated tokens (clock skew)
  if (now.getTime() - parsed.iat > ttlMs) return null;  // expired
  return { username: parsed.u, role: parsed.r };
}
