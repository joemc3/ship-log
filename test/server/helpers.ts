import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Express } from 'express';
import { simpleGit } from 'simple-git';
import { loadConfig, type Config } from '../../src/server/config.js';
import { UsersStore } from '../../src/server/users.js';
import { createApp } from '../../src/server/app.js';
import { ShipStore } from '../../src/server/store.js';

export const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');
export const FIXED_NOW = () => new Date('2024-07-01T00:00:00Z');

export interface TestApp {
  app: Express;
  users: UsersStore;
  config: Config;
  store: ShipStore;
  dataDir: string;
}

/**
 * Build an app over the demo dataset. Default = authenticated (non-demo) mode
 * with a seeded owner1/crew1 over a throwaway git data repo; pass { demo: true }
 * for the no-auth demo path.
 */
export async function buildTestApp(opts: { demo?: boolean; clientDir?: string } = {}): Promise<TestApp> {
  const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
  const dataDir = opts.demo ? DEMO : await makeDataRepo();
  const env: NodeJS.ProcessEnv = opts.demo
    ? { USERS_PATH: usersPath }
    : { DATA_DIR: dataDir, SESSION_SECRET: 'test-secret', COOKIE_SECURE: 'false', USERS_PATH: usersPath };
  if (opts.clientDir) env.CLIENT_DIR = opts.clientDir;
  const config = loadConfig(env, DEMO);
  const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW });
  const users = await UsersStore.load(usersPath);
  if (!opts.demo) {
    await users.add('owner1', 'ownerpass123', 'owner');
    await users.add('crew1', 'crewpass123', 'crew');
  }
  const app = createApp({ config, store, users, now: FIXED_NOW });
  return { app, users, config, store, dataDir };
}

/** Copy the demo dataset into a fresh temp dir and git-init it, so write tests
 *  commit into a throwaway repo (never the app repo). Returns the dir path. */
export async function makeDataRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'shiplog-data-'));
  await cp(DEMO, dir, { recursive: true });
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@shiplog.test');
  await git.addConfig('user.name', 'Test');
  await git.add('.');
  await git.commit('seed demo dataset');
  return dir;
}

/** A working clone of a bare data repo: its dir plus a simple-git handle with a
 *  committer identity configured (so `commit`/`push` work without global config). */
export interface WorkClone {
  dir: string;
  git: ReturnType<typeof simpleGit>;
}

/**
 * Build a temp BARE repo seeded with the demo dataset (over a throwaway working
 * clone), so sync tests run entirely against `file://` with no network. Returns
 * the bare repo path; clone it with {@link cloneData}. This is the harness for
 * every two-way-sync test (store sync-state, scheduler, integration).
 */
export async function makeBareDataRepo(): Promise<string> {
  const bare = mkdtempSync(join(tmpdir(), 'shiplog-bare-'));
  await simpleGit(bare).init(['--bare']);
  const seedDir = mkdtempSync(join(tmpdir(), 'shiplog-seed-'));
  await cp(DEMO, seedDir, { recursive: true });
  const g = simpleGit(seedDir);
  await g.init();
  await g.addConfig('user.email', 'seed@shiplog.test');
  await g.addConfig('user.name', 'Seed');
  await g.add('.');
  await g.commit('seed demo dataset');
  // Push the seed onto the bare repo's default branch so clones have a HEAD.
  const branch = (await g.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  await g.addRemote('origin', `file://${bare}`);
  await g.push(['-u', 'origin', branch]);
  return bare;
}

/** Clone a bare data repo into a fresh working dir with a committer identity set. */
export async function cloneData(bare: string, who = 'cap'): Promise<WorkClone> {
  const dir = mkdtempSync(join(tmpdir(), `shiplog-clone-${who}-`));
  await simpleGit().clone(`file://${bare}`, dir);
  const git = simpleGit(dir);
  await git.addConfig('user.email', `${who}@boat.test`);
  await git.addConfig('user.name', who);
  return { dir, git };
}
