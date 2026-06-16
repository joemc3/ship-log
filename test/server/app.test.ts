import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from '../../src/server/config.js';
import { UsersStore } from '../../src/server/users.js';
import { createApp } from '../../src/server/app.js';
import { ShipStore } from '../../src/server/store.js';
import { DEMO, FIXED_NOW, makeDataRepo } from './helpers.js';

/** Build an app over a throwaway data repo with an explicit COOKIE_SECURE so the
 *  hardening headers can be asserted in both a TLS (production) and plain-http
 *  (local dev) posture. */
async function buildApp(cookieSecure: 'true' | 'false'): Promise<Express> {
  const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
  const dataDir = await makeDataRepo();
  const config = loadConfig(
    { DATA_DIR: dataDir, SESSION_SECRET: 'test-secret', COOKIE_SECURE: cookieSecure, USERS_PATH: usersPath },
    DEMO,
  );
  const store = await ShipStore.open(dataDir, { now: FIXED_NOW });
  const users = await UsersStore.load(usersPath);
  return createApp({ config, store, users, now: FIXED_NOW });
}

describe('transport hardening headers', () => {
  it('always sets the baseline hardening headers (nosniff, no x-powered-by)', async () => {
    const app = await buildApp('true');
    const res = await request(app).get('/api/welcome');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  describe('production posture (COOKIE_SECURE=true / behind TLS)', () => {
    it('sets a long-lived HSTS header with includeSubDomains', async () => {
      const app = await buildApp('true');
      const res = await request(app).get('/api/welcome');
      const hsts = res.headers['strict-transport-security'];
      expect(hsts).toBeDefined();
      // Long max-age (>= ~6 months) and subdomain coverage.
      const maxAge = Number(/max-age=(\d+)/.exec(hsts!)?.[1] ?? 0);
      expect(maxAge).toBeGreaterThanOrEqual(15_552_000);
      expect(hsts).toMatch(/includeSubDomains/);
    });

    it('sets a same-origin Content-Security-Policy suited to the SPA', async () => {
      const app = await buildApp('true');
      const res = await request(app).get('/api/welcome');
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).toMatch(/default-src 'self'/);
      // Images may be data: URIs (inline/compressed thumbnails in the bundle).
      expect(csp).toMatch(/img-src[^;]*data:/);
      // No framing (clickjacking guard).
      expect(csp).toMatch(/frame-ancestors 'none'/);
      // Must NOT open the policy up to arbitrary origins.
      expect(csp).not.toMatch(/\*/);
    });

    it('still returns JSON (headers do not break the API contract)', async () => {
      const app = await buildApp('true');
      const res = await request(app).get('/api/welcome');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.name).toBeTruthy();
    });

    it('returns a JSON 404 with the hardening headers still attached', async () => {
      const app = await buildApp('true');
      const res = await request(app).get('/api/nope');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['content-security-policy']).toBeDefined();
    });
  });

  describe('local-dev posture (COOKIE_SECURE=false / plain http)', () => {
    it('does NOT send HSTS (would pin http clients to https on localhost)', async () => {
      const app = await buildApp('false');
      const res = await request(app).get('/api/welcome');
      expect(res.headers['strict-transport-security']).toBeUndefined();
    });

    it('relaxes the CSP so it never upgrades/blocks plain-http dev assets', async () => {
      const app = await buildApp('false');
      const res = await request(app).get('/api/welcome');
      const csp = res.headers['content-security-policy'];
      // Either absent, or present without an https upgrade directive.
      if (csp) expect(csp).not.toMatch(/upgrade-insecure-requests/);
    });

    it('keeps the baseline headers and JSON contract in local mode', async () => {
      const app = await buildApp('false');
      const res = await request(app).get('/api/welcome');
      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  it('demo mode (no TLS) does not send HSTS', async () => {
    const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
    const config = loadConfig({ USERS_PATH: usersPath }, DEMO);
    const store = await ShipStore.open(DEMO, { now: FIXED_NOW });
    const users = await UsersStore.load(usersPath);
    const app = createApp({ config, store, users, now: FIXED_NOW });
    const res = await request(app).get('/api/welcome');
    // Demo defaults to cookieSecure=true (COOKIE_SECURE unset) BUT demo is plain
    // http with no tunnel — HSTS must stay off in demo regardless.
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.status).toBe(200);
  });
});
