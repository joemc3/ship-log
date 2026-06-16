import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { loadConfig } from '../../src/server/config.js';
import { prepareStore } from '../../src/server/boot.js';
import { DEMO } from './helpers.js';

const NOW = () => new Date('2024-07-01T00:00:00Z');

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'shiplog-boot-'));
}

/** Seed a bare repo from the demo dataset; return its path. */
async function makeSeededBare(): Promise<string> {
  const bare = tmpDir();
  await simpleGit(bare).init(['--bare']);
  const work = tmpDir();
  cpSync(DEMO, work, { recursive: true });
  const wg = simpleGit(work);
  await wg.init();
  await wg.addConfig('user.email', 'seed@shiplog.test');
  await wg.addConfig('user.name', 'Seed');
  await wg.add('.');
  await wg.commit('seed demo dataset');
  await wg.addRemote('origin', bare);
  const branch = (await wg.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  await wg.push('origin', branch);
  return bare;
}

describe('prepareStore (clone-or-open on boot)', () => {
  it('clones DATA_REPO_URL into an empty DATA_DIR and loads the dataset', async () => {
    const bare = await makeSeededBare();
    const dataDir = join(tmpDir(), 'clone'); // does not exist yet
    const config = loadConfig(
      { DATA_DIR: dataDir, DATA_REPO_URL: `file://${bare}`, SESSION_SECRET: 's' },
      DEMO,
    );
    const { store, readOnly } = await prepareStore(config, { now: NOW });
    expect(readOnly).toBe(false);
    expect(existsSync(join(dataDir, 'boat.yaml'))).toBe(true);
    // Dataset materialized and parsed from the clone.
    expect(store.current().trips.length).toBeGreaterThan(0);
    // A write commits into the working clone (git enabled).
    const rec = await store.createRecord('vendor', { name: 'Boot Test' }, '', { name: 'Cap', email: 'c@b' });
    expect(rec.id).toBe('v-boot-test');
    const line = (await simpleGit(dataDir).raw(['log', '-1', '--format=%s'])).trim();
    expect(line).toBe('add vendor v-boot-test');
  });

  it('opens an existing clone in place rather than re-cloning', async () => {
    const bare = await makeSeededBare();
    const dataDir = join(tmpDir(), 'clone');
    const config = loadConfig(
      { DATA_DIR: dataDir, DATA_REPO_URL: `file://${bare}`, SESSION_SECRET: 's' },
      DEMO,
    );
    await prepareStore(config, { now: NOW }); // first boot clones
    writeFileSync(join(dataDir, 'local-scratch.txt'), 'keep me');
    const { store, readOnly } = await prepareStore(config, { now: NOW }); // second boot opens
    expect(readOnly).toBe(false);
    expect(existsSync(join(dataDir, 'local-scratch.txt'))).toBe(true);
    expect(store.current().trips.length).toBeGreaterThan(0);
  });

  it('boots READ-ONLY with a warning when the clone fails (bad remote)', async () => {
    const dataDir = join(tmpDir(), 'clone');
    const config = loadConfig(
      { DATA_DIR: dataDir, DATA_REPO_URL: `file://${join(tmpDir(), 'does-not-exist')}`, SESSION_SECRET: 's' },
      DEMO,
    );
    const { store, readOnly, warning } = await prepareStore(config, { now: NOW, fallbackDir: DEMO });
    expect(readOnly).toBe(true);
    expect(warning).toMatch(/READ-ONLY/);
    // The store still opened (over the demo fallback) instead of crashing.
    expect(store.current().trips.length).toBeGreaterThan(0);
  });

  it('opens DATA_DIR in place when no DATA_REPO_URL is set (persist-without-commit scratch)', async () => {
    const dataDir = tmpDir();
    writeFileSync(join(dataDir, 'boat.yaml'), 'name: Scratch\n');
    const config = loadConfig({ DATA_DIR: dataDir, SESSION_SECRET: 's' }, DEMO);
    const { store, readOnly } = await prepareStore(config, { now: NOW });
    expect(readOnly).toBe(false);
    const rec = await store.createRecord('vendor', { name: 'Scratch Vendor' }, '', { name: 'Cap', email: 'c@b' });
    expect(rec.id).toBe('v-scratch-vendor'); // persisted even with no git repo
  });

  it('demo mode opens the demo dir with sync disabled', async () => {
    const config = loadConfig({}, DEMO);
    expect(config.demo).toBe(true);
    expect(config.dataRepoUrl).toBeUndefined();
    const { store, readOnly } = await prepareStore(config, { now: NOW });
    expect(readOnly).toBe(false);
    expect(store.current().trips.length).toBeGreaterThan(0);
  });
});
