import { describe, it, expect } from 'vitest';
import { createToken, verifyToken, SESSION_COOKIE } from '../../src/server/session.js';

const SECRET = 'unit-test-secret';
const TTL = 1000 * 60 * 60; // 1h
const now = new Date('2024-07-01T00:00:00Z');

describe('session token', () => {
  it('round-trips a valid session', () => {
    const token = createToken({ username: 'cap', role: 'owner' }, SECRET, now);
    expect(verifyToken(token, SECRET, now, TTL)).toEqual({ username: 'cap', role: 'owner' });
  });

  it('round-trips a crew session', () => {
    const token = createToken({ username: 'hand', role: 'crew' }, SECRET, now);
    expect(verifyToken(token, SECRET, now, TTL)).toEqual({ username: 'hand', role: 'crew' });
  });

  it('rejects a future-dated token (clock skew)', () => {
    const future = new Date(now.getTime() + 1000 * 60);
    const token = createToken({ username: 'cap', role: 'owner' }, SECRET, future);
    expect(verifyToken(token, SECRET, now, TTL)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = createToken({ username: 'cap', role: 'owner' }, SECRET, now);
    expect(verifyToken(token, 'other-secret', now, TTL)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = createToken({ username: 'cap', role: 'crew' }, SECRET, now);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'cap', r: 'owner', iat: now.getTime() })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, SECRET, now, TTL)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = createToken({ username: 'cap', role: 'owner' }, SECRET, now);
    const later = new Date(now.getTime() + TTL + 1);
    expect(verifyToken(token, SECRET, later, TTL)).toBeNull();
  });

  it('returns null for a missing or malformed token', () => {
    expect(verifyToken(undefined, SECRET, now, TTL)).toBeNull();
    expect(verifyToken('not-a-token', SECRET, now, TTL)).toBeNull();
  });

  it('exposes the cookie name', () => {
    expect(SESSION_COOKIE).toBe('slog_session');
  });
});
