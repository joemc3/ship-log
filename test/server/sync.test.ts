import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { ShipStore } from '../../src/server/store.js';
import { GitRepo } from '../../src/server/git.js';
import { SyncScheduler, type Timer } from '../../src/server/sync.js';
import { makeBareDataRepo, cloneData } from './helpers.js';

const NOW = () => new Date('2024-07-01T00:00:00Z');

/**
 * A controllable timer: it records each scheduled callback so a test can fire
 * "ticks" deterministically, with no real waiting. `set` returns an incrementing
 * handle; `clear` marks it cleared.
 */
function fakeTimer(): Timer & { fire: () => Promise<void>; intervalMs: number | null; cleared: boolean } {
  let cb: (() => void | Promise<void>) | null = null;
  return {
    intervalMs: null,
    cleared: false,
    set(fn: () => void | Promise<void>, ms: number): unknown {
      cb = fn;
      this.intervalMs = ms;
      return 1;
    },
    clear(_handle: unknown): void {
      this.cleared = true;
    },
    async fire(): Promise<void> {
      if (cb) await cb(); // the scheduler's tick returns its pull promise → await it fully
    },
  };
}

async function openStoreOn(bare: string, who = 'app'): Promise<{ store: ShipStore; dir: string }> {
  const { dir } = await cloneData(bare, who);
  const git = await GitRepo.open(dir);
  const store = await ShipStore.open(dir, { now: NOW, git });
  return { store, dir };
}

describe('SyncScheduler', () => {
  it('pulls once on start, then registers the interval timer', async () => {
    const bare = await makeBareDataRepo();
    const { store } = await openStoreOn(bare);
    const pullSpy = vi.spyOn(store, 'pull');
    const timer = fakeTimer();
    const sched = new SyncScheduler(store, { intervalMs: 300_000, timer });

    await sched.start();
    expect(pullSpy).toHaveBeenCalledTimes(1); // boot pull
    expect(timer.intervalMs).toBe(300_000);

    await timer.fire();
    expect(pullSpy).toHaveBeenCalledTimes(2); // one interval tick

    sched.stop();
    expect(timer.cleared).toBe(true);
  });

  it('a scheduler tick picks up another clone\'s push and refreshes the dataset', async () => {
    const bare = await makeBareDataRepo();
    const { store } = await openStoreOn(bare);
    const timer = fakeTimer();
    const sched = new SyncScheduler(store, { intervalMs: 1000, timer });
    await sched.start(); // boot pull (nothing new yet)

    // Another clone adds a vendor and pushes it to the bare remote.
    const other = await cloneData(bare, 'other');
    writeFileSync(join(other.dir, 'vendors', 'v-from-other.md'), '---\nid: v-from-other\nname: From Other\n---\n');
    await other.git.add('.');
    await other.git.commit('other adds vendor');
    await other.git.push();

    // The app does not see it yet.
    expect(store.current().vendors.some((v) => v.id === 'v-from-other')).toBe(false);

    // A scheduler tick pulls + reloads → the app's dataset now reflects it.
    await timer.fire();
    expect(store.current().vendors.some((v) => v.id === 'v-from-other')).toBe(true);
    expect(store.syncState().status).toBe('ok');
    expect(store.syncState().lastPullAt).toBeInstanceOf(Date);

    sched.stop();
  });

  it('does not start when sync is disabled (no remote)', async () => {
    // A local git repo with NO remote is not syncable.
    const { dir } = await cloneData(await makeBareDataRepo(), 'norem');
    await simpleGit(dir).removeRemote('origin');
    const store = await ShipStore.open(dir, { now: NOW });
    expect(store.syncEnabled()).toBe(false);
    const pullSpy = vi.spyOn(store, 'pull');
    const timer = fakeTimer();
    const sched = new SyncScheduler(store, { intervalMs: 1000, timer });
    await sched.start();
    expect(pullSpy).not.toHaveBeenCalled();
    expect(timer.intervalMs).toBeNull(); // never registered an interval
    sched.stop(); // safe no-op
  });

  it('uses the real global timer by default (interval registered, then cleared on stop)', async () => {
    const bare = await makeBareDataRepo();
    const { store } = await openStoreOn(bare);
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const sched = new SyncScheduler(store, { intervalMs: 1000 });
    await sched.start();
    expect(setSpy).toHaveBeenCalled();
    sched.stop();
    expect(clearSpy).toHaveBeenCalled();
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
