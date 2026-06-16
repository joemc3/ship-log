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
import { SyncScheduler, type Timer } from '../../src/server/sync.js';
import { DEMO, FIXED_NOW, makeBareDataRepo, cloneData } from './helpers.js';

const AUTHOR = { name: 'Cap', email: 'cap@boat.test' };

/** A controllable interval timer: a test fires the registered tick by hand. */
function fakeTimer(): Timer & { fire: () => Promise<void> } {
  let cb: (() => void | Promise<void>) | null = null;
  return {
    set(fn: () => void | Promise<void>): unknown { cb = fn; return 1; },
    clear(): void { /* no-op for the test */ },
    async fire(): Promise<void> { if (cb) await cb(); },
  };
}

/** Build the app + store over a clone of `bare`, plus a hand-fired scheduler. */
async function buildAppOn(bare: string) {
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
  const app: Express = createApp({ config, store, users, now: FIXED_NOW });
  const timer = fakeTimer();
  const scheduler = new SyncScheduler(store, { intervalMs: 60_000, timer });
  return { app, store, dir, scheduler, timer };
}

async function ownerAgent(app: Express) {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username: 'owner1', password: 'ownerpass123' }).expect(200);
  return agent;
}

async function headSubject(dir: string): Promise<string> {
  return (await simpleGit(dir).raw(['log', '-1', '--format=%s'])).trim();
}

describe('two-way sync integration (app store + a second Cowork clone)', () => {
  it('(a) non-conflicting concurrent edits CONVERGE; the app dataset reflects the Cowork change after a tick', async () => {
    const bare = await makeBareDataRepo();
    const { app, store, dir, scheduler, timer } = await buildAppOn(bare);
    await scheduler.start(); // boot pull (nothing new)

    // Cowork (a second clone) writes an UNRELATED record and pushes it.
    const cowork = await cloneData(bare, 'cowork');
    writeFileSync(join(cowork.dir, 'vendors', 'v-cowork-rigging.md'), '---\nid: v-cowork-rigging\nname: Cowork Rigging\n---\n');
    await cowork.git.add('.');
    await cowork.git.commit('cowork adds vendor');
    await cowork.git.push();

    // Meanwhile the APP makes its own UNRELATED write through the store. Its
    // post-write sync pulls Cowork's commit (rebasing the app's own commit atop it)
    // and pushes — both land on the bare remote, neither is lost.
    const agent = await ownerAgent(app);
    await store.createRecord('vendor', { name: 'App Sails' }, 'From the app.', AUTHOR);

    // The app's in-memory dataset now reflects BOTH writes (its own + Cowork's,
    // pulled in during the post-write sync's rebase).
    expect(store.current().vendors.some((v) => v.id === 'v-app-sails')).toBe(true);
    expect(store.current().vendors.some((v) => v.id === 'v-cowork-rigging')).toBe(true);
    expect(store.syncState().status).toBe('ok');

    // The bare remote holds BOTH commits (a fresh clone sees both files).
    const verify = await cloneData(bare, 'verify');
    expect((await simpleGit(verify.dir).raw(['ls-files', 'vendors'])).trim()).toContain('v-app-sails.md');
    expect((await simpleGit(verify.dir).raw(['ls-files', 'vendors'])).trim()).toContain('v-cowork-rigging.md');

    // A LATER Cowork push is picked up purely by a scheduler tick (no app write).
    // Cowork integrates the app's pushed commit first, then commits + pushes.
    await cowork.git.pull(['--rebase']);
    writeFileSync(join(cowork.dir, 'vendors', 'v-cowork-late.md'), '---\nid: v-cowork-late\nname: Cowork Late\n---\n');
    await cowork.git.add('.');
    await cowork.git.commit('cowork adds late vendor');
    await cowork.git.push();
    expect(store.current().vendors.some((v) => v.id === 'v-cowork-late')).toBe(false); // not seen yet

    await timer.fire(); // one scheduler tick → pull --rebase + reload
    expect(store.current().vendors.some((v) => v.id === 'v-cowork-late')).toBe(true);

    // /api/me reflects a healthy sync.
    const me = await agent.get('/api/me');
    expect(me.body.sync.status).toBe('ok');

    scheduler.stop();
    void dir;
  });

  it('(b)+(c) a CONFLICTING edit → conflict, auto-push paused, surfaced via /api/me, and the remote is NOT clobbered', async () => {
    const bare = await makeBareDataRepo();
    const { app, store, dir } = await buildAppOn(bare);

    // Cowork edits the shared boat.yaml and pushes FIRST.
    const cowork = await cloneData(bare, 'cowork');
    writeFileSync(join(cowork.dir, 'boat.yaml'), 'name: Valkyrie\nmake: Cowork\nmodel: C\nyear: 1999\nhailingPort: Cowork Bay\n');
    await cowork.git.add('.');
    await cowork.git.commit('cowork edits boat');
    await cowork.git.push();
    const coworkSha = (await simpleGit(cowork.dir).revparse(['HEAD'])).trim();

    // The app edits the SAME file out-of-band, then a store write triggers the
    // post-write sync: pull --rebase conflicts → conflict state, no push.
    writeFileSync(join(dir, 'boat.yaml'), 'name: Valkyrie\nmake: App\nmodel: A\nyear: 2002\nhailingPort: App Harbor\n');
    await simpleGit(dir).add('boat.yaml');
    await simpleGit(dir).commit('app edits boat');
    await store.createRecord('vendor', { name: 'Paused Vendor' }, '', AUTHOR);

    // (b) sync-state is conflict; the app's own write persisted locally.
    expect(store.syncState().status).toBe('conflict');
    expect(store.current().vendors.some((v) => v.id === 'v-paused-vendor')).toBe(true);

    // (c) the remote was NOT clobbered: bare HEAD is still Cowork's commit.
    expect((await simpleGit(bare).raw(['rev-parse', 'HEAD'])).trim()).toBe(coworkSha);

    // A subsequent app write commits locally but stays PAUSED (no push attempted).
    await store.createRecord('vendor', { name: 'Still Paused' }, '', AUTHOR);
    expect(store.syncState().status).toBe('conflict');
    expect(store.current().vendors.some((v) => v.id === 'v-still-paused')).toBe(true);
    expect((await simpleGit(bare).raw(['rev-parse', 'HEAD'])).trim()).toBe(coworkSha); // remote still untouched

    // The conflict surfaces via /api/me (summary) and /api/sync (with generic reason).
    const agent = await ownerAgent(app);
    const me = await agent.get('/api/me');
    expect(me.body.sync.status).toBe('conflict');
    expect(me.body.sync.lastError).toBeUndefined();
    const sync = await agent.get('/api/sync');
    expect(sync.body.status).toBe('conflict');
    if (sync.body.lastError) {
      expect(sync.body.lastError).not.toMatch(/file:\/\//);
      expect(sync.body.lastError).not.toMatch(/\/(tmp|var|Users)\//);
    }

    // (c) the bare repo retained BOTH histories (no force-push lost Cowork's work):
    // Cowork's commit is reachable, and the app's diverging commit lives in the app
    // clone — a fresh clone of the bare still shows Cowork's boat edit.
    expect(await headSubject(cowork.dir)).toBe('cowork edits boat');
    const fresh = await cloneData(bare, 'fresh');
    expect((await simpleGit(fresh.dir).raw(['log', '-1', '--format=%s'])).trim()).toBe('cowork edits boat');
  });
});
