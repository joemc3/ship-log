import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { simpleGit } from 'simple-git';
import { loadConfig } from '../../src/server/config.js';
import { UsersStore } from '../../src/server/users.js';
import { createApp } from '../../src/server/app.js';
import { ShipStore } from '../../src/server/store.js';
import { buildTestApp, DEMO, FIXED_NOW } from './helpers.js';

/**
 * The PUBLIC welcome hero photo. GET /api/welcome exposes the curated heroPhoto
 * path (guest-safe), and GET /api/welcome/hero streams the boat's hero image with
 * NO auth — it is the guest-facing surface, unlike /photos which is auth-gated
 * outside demo mode. Path-traversal-safe + 404 when no hero is configured.
 */

/** Build a non-demo app over a fresh git data repo whose boat.yaml is replaced
 *  with `boatYaml` (so we can omit / craft heroPhoto). Photos are copied from the
 *  demo dir so the real boat-hero.jpg is present. */
async function appWithBoat(boatYaml: string) {
  const dir = mkdtempSync(join(tmpdir(), 'shiplog-hero-'));
  await cp(DEMO, dir, { recursive: true });
  writeFileSync(join(dir, 'boat.yaml'), boatYaml, 'utf8');
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@shiplog.test');
  await git.addConfig('user.name', 'Test');
  await git.add('.');
  await git.commit('seed');
  const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
  const config = loadConfig(
    { DATA_DIR: dir, SESSION_SECRET: 'test-secret', COOKIE_SECURE: 'false', USERS_PATH: usersPath },
    DEMO,
  );
  const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW });
  const users = await UsersStore.load(usersPath);
  const app = createApp({ config, store, users, now: FIXED_NOW });
  return { app, dir };
}

describe('GET /api/welcome — heroPhoto in the curated public block', () => {
  it('includes heroPhoto from the demo boat (demo app)', async () => {
    const { app } = await buildTestApp({ demo: true });
    const res = await request(app).get('/api/welcome');
    expect(res.status).toBe(200);
    expect(res.body.heroPhoto).toBe('photos/boat-hero.jpg');
  });
});

describe('GET /api/welcome/hero — public hero photo stream', () => {
  it('streams the demo hero photo as image/jpeg (demo app)', async () => {
    const { app } = await buildTestApp({ demo: true });
    const res = await request(app).get('/api/welcome/hero');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('is PUBLIC: serves with NO auth cookie outside demo mode (unlike /photos)', async () => {
    // makeDataRepo copies demo/ (incl. photos/ and the boat.yaml heroPhoto).
    const { app } = await buildTestApp();
    // No auth cookie at all — a guest non-demo request.
    const hero = await request(app).get('/api/welcome/hero');
    expect(hero.status).toBe(200);
    expect(hero.headers['content-type']).toMatch(/image\/jpeg/);
    // Contrast: the auth-gated /photos route 401s the same guest.
    const photo = await request(app).get('/photos/boat-hero.jpg');
    expect(photo.status).toBe(401);
  });

  it('404s when the boat has no heroPhoto configured', async () => {
    const { app } = await appWithBoat('name: No Hero Boat\n');
    const res = await request(app).get('/api/welcome/hero');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'no hero photo' });
  });

  it('never escapes photos/: a traversal heroPhoto never leaks another file', async () => {
    // basename() + isInside reduce any path to a single segment inside photos/;
    // ../boat.yaml has basename boat.yaml (not a real image in photos/) -> 404,
    // and the boat.yaml contents are never served.
    const { app } = await appWithBoat('name: Sneaky\nheroPhoto: ../boat.yaml\n');
    const res = await request(app).get('/api/welcome/hero');
    expect([400, 404]).toContain(res.status);
    expect(res.text ?? '').not.toContain('name:'); // boat.yaml contents never leak
  });

  it('tolerates a heroPhoto with a photos/ prefix and serves the file by basename', async () => {
    const { app } = await appWithBoat('name: Prefixed\nheroPhoto: photos/boat-hero.jpg\n');
    const res = await request(app).get('/api/welcome/hero');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
  });

  it('404s when the referenced hero file is missing', async () => {
    const { app } = await appWithBoat('name: Missing File\nheroPhoto: photos/not-there.jpg\n');
    const res = await request(app).get('/api/welcome/hero');
    expect(res.status).toBe(404);
  });
});
