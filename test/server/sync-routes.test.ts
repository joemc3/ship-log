import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { simpleGit } from 'simple-git';
import { loadConfig } from '../../src/server/config.js';
import { UsersStore } from '../../src/server/users.js';
import { createApp } from '../../src/server/app.js';
import { ShipStore } from '../../src/server/store.js';
import { GitRepo } from '../../src/server/git.js';
import { DEMO, FIXED_NOW, makeBareDataRepo, cloneData } from './helpers.js';

const AUTHOR = { name: 'Cap', email: 'cap@boat.test' };

/** Build an authenticated app whose store is a real clone of `bare` (so its sync
 *  state is observable). Returns the app, store, and the working-clone dir. */
async function buildSyncApp(bare: string): Promise<{ app: Express; store: ShipStore; dir: string }> {
  const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
  const { dir } = await cloneData(bare, 'app');
  const config = loadConfig(
    { DATA_DIR: dir, SESSION_SECRET: 'test-secret', COOKIE_SECURE: 'false', USERS_PATH: usersPath },
    DEMO,
  );
  const git = await GitRepo.open(dir);
  const store = await ShipStore.open(dir, { now: FIXED_NOW, git });
  const users = await UsersStore.load(usersPath);
  await users.add('owner1', 'ownerpass123', 'owner');
  await users.add('crew1', 'crewpass123', 'crew');
  const app = createApp({ config, store, users, now: FIXED_NOW });
  return { app, store, dir };
}

/** Drive `store` (clone at `dir`) into a sync conflict via a second clone editing
 *  the same file and pushing first. */
async function driveIntoConflict(store: ShipStore, dir: string, bare: string): Promise<void> {
  const other = await cloneData(bare, 'other');
  writeFileSync(join(other.dir, 'boat.yaml'), 'name: Valkyrie\nmake: Other\nmodel: X\nyear: 2000\nhailingPort: Elsewhere\n');
  await other.git.add('.');
  await other.git.commit('other edits boat');
  await other.git.push();
  writeFileSync(join(dir, 'boat.yaml'), 'name: Valkyrie\nmake: App\nmodel: Y\nyear: 2001\nhailingPort: Home\n');
  await simpleGit(dir).add('boat.yaml');
  await simpleGit(dir).commit('app edits boat');
  await store.createRecord('vendor', { name: 'Local Only' }, '', AUTHOR);
  expect(store.syncState().status).toBe('conflict');
}

async function login(app: Express, username: string, password: string) {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username, password }).expect(200);
  return agent;
}

describe('sync routes', () => {
  it('GET /api/me carries a sync summary (status + last pull/push, no error detail)', async () => {
    const bare = await makeBareDataRepo();
    const { app, store } = await buildSyncApp(bare);
    const agent = await login(app, 'owner1', 'ownerpass123');
    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.sync).toBeDefined();
    expect(me.body.sync.status).toBe('ok');
    // Summary only — never the raw error string.
    expect(me.body.sync.lastError).toBeUndefined();
    expect(store.syncState().status).toBe('ok');
  });

  it('GET /api/me + /api/sync report a conflict once the store is in conflict', async () => {
    const bare = await makeBareDataRepo();
    const { app, store, dir } = await buildSyncApp(bare);
    await driveIntoConflict(store, dir, bare);

    const agent = await login(app, 'owner1', 'ownerpass123');
    const me = await agent.get('/api/me');
    expect(me.body.sync.status).toBe('conflict');
    expect(me.body.sync.lastError).toBeUndefined(); // /api/me stays a summary

    const sync = await agent.get('/api/sync');
    expect(sync.status).toBe(200);
    expect(sync.body.status).toBe('conflict');
    // The dedicated endpoint may carry a GENERIC reason, but never a path/URL.
    if (sync.body.lastError) {
      expect(sync.body.lastError).not.toMatch(/file:\/\//);
      expect(sync.body.lastError).not.toMatch(/\/(tmp|var|Users)\//);
    }
  });

  it('GET /api/sync is available to crew (authenticated), reporting conflict', async () => {
    const bare = await makeBareDataRepo();
    const { app, store, dir } = await buildSyncApp(bare);
    await driveIntoConflict(store, dir, bare);
    const agent = await login(app, 'crew1', 'crewpass123');
    const sync = await agent.get('/api/sync');
    expect(sync.status).toBe(200);
    expect(sync.body.status).toBe('conflict');
  });

  it('a guest does NOT receive sync internals: /api/sync is 401, /api/me omits sync', async () => {
    const bare = await makeBareDataRepo();
    const { app } = await buildSyncApp(bare);
    // No login → guest.
    const sync = await request(app).get('/api/sync');
    expect(sync.status).toBe(401);
    expect(sync.body.status).toBeUndefined();

    const me = await request(app).get('/api/me');
    expect(me.body.role).toBe('guest');
    expect(me.body.sync).toBeUndefined(); // guests get no sync summary
  });

  it('demo mode reports sync disabled and exposes no conflict surface', async () => {
    // Demo forces sync off (boot/prepareStore opens the demo store with sync:false),
    // so even though the bundled demo dir sits inside this app repo's own `origin`
    // remote, demo reports sync disabled.
    const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
    const config = loadConfig({ USERS_PATH: usersPath }, DEMO);
    const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW, sync: !config.demo });
    const users = await UsersStore.load(usersPath);
    const app = createApp({ config, store, users, now: FIXED_NOW });
    // Demo => every request is owner-equivalent; /api/me reports demo + a disabled sync.
    const me = await request(app).get('/api/me');
    expect(me.body.demo).toBe(true);
    expect(me.body.sync.status).toBe('ok');
    expect(me.body.sync.enabled).toBe(false);
    const sync = await request(app).get('/api/sync');
    expect(sync.status).toBe(200);
    expect(sync.body.enabled).toBe(false);
  });
});
