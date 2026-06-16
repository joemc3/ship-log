import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Express } from 'express';
import { simpleGit } from 'simple-git';
import { loadConfig, type Config } from '../../src/server/config.js';
import { loadDataset } from '../../src/data/index.js';
import { UsersStore } from '../../src/server/users.js';
import { createApp } from '../../src/server/app.js';

export const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');
export const FIXED_NOW = () => new Date('2024-07-01T00:00:00Z');

export interface TestApp { app: Express; users: UsersStore; config: Config; }

/**
 * Build an app over the demo dataset. Default = authenticated (non-demo) mode
 * with a seeded owner1/crew1; pass { demo: true } for the no-auth demo path.
 */
export async function buildTestApp(opts: { demo?: boolean } = {}): Promise<TestApp> {
  const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
  const env = opts.demo
    ? { USERS_PATH: usersPath }
    : { DATA_DIR: DEMO, SESSION_SECRET: 'test-secret', COOKIE_SECURE: 'false', USERS_PATH: usersPath };
  const config = loadConfig(env, DEMO);
  const dataset = await loadDataset(config.dataDir);
  const users = await UsersStore.load(usersPath);
  if (!opts.demo) {
    await users.add('owner1', 'ownerpass123', 'owner');
    await users.add('crew1', 'crewpass123', 'crew');
  }
  const app = createApp({ config, dataset, users, now: FIXED_NOW });
  return { app, users, config };
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
