import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { ShipStore } from '../../src/server/store.js';
import { GitRepo } from '../../src/server/git.js';
import { makeBareDataRepo, cloneData } from './helpers.js';

const NOW = () => new Date('2024-07-01T00:00:00Z');
const AUTHOR = { name: 'Cap', email: 'cap@boat.test' };

/** Open a ShipStore over a fresh clone of `bare`, reusing the cloned GitRepo. */
async function openStoreOn(bare: string, who = 'cap'): Promise<{ store: ShipStore; dir: string }> {
  const { dir } = await cloneData(bare, who);
  const git = await GitRepo.open(dir);
  const store = await ShipStore.open(dir, { now: NOW, git });
  return { store, dir };
}

async function headSubject(dir: string): Promise<string> {
  return (await simpleGit(dir).raw(['log', '-1', '--format=%s'])).trim();
}

describe('ShipStore sync-state', () => {
  it('starts ok with no pull/push timestamps before any sync', async () => {
    const bare = await makeBareDataRepo();
    const { store } = await openStoreOn(bare);
    const s = store.syncState();
    expect(s.status).toBe('ok');
    expect(s.lastPullAt).toBeUndefined();
    expect(s.lastPushAt).toBeUndefined();
    expect(s.lastError).toBeUndefined();
  });

  it('after a write with a clean remote, pushes and records lastPushAt; status stays ok', async () => {
    const bare = await makeBareDataRepo();
    const { store } = await openStoreOn(bare);
    await store.createRecord('vendor', { name: 'Rigging Pros' }, 'Great service.', AUTHOR);
    const s = store.syncState();
    expect(s.status).toBe('ok');
    expect(s.lastPushAt).toBeInstanceOf(Date);
    // A fresh clone of the bare repo sees the pushed record.
    const verify = await cloneData(bare, 'verify');
    expect((await simpleGit(verify.dir).raw(['ls-files', 'vendors'])).trim()).toContain('v-rigging-pros.md');
  });

  it('CONFLICT: a write that cannot be pushed enters conflict, persists locally, and pauses auto-push', async () => {
    const bare = await makeBareDataRepo();
    const { store, dir } = await openStoreOn(bare, 'app');
    // A second clone edits the SAME file and pushes first → app's later push will
    // hit a non-fast-forward whose pull-rebase conflicts.
    const other = await cloneData(bare, 'other');
    writeFileSync(join(other.dir, 'boat.yaml'), 'name: Valkyrie\nmake: Other\nmodel: X\nyear: 2000\nhailingPort: Elsewhere\n');
    await other.git.add('.');
    await other.git.commit('other edits boat');
    await other.git.push();

    // App edits the SAME file (boat.yaml via updateRecord is not possible; use a
    // direct conflicting commit path: app updates the boat through a record write
    // that collides). Simplest deterministic collision: app commits its own change
    // to boat.yaml out-of-band, then a store write triggers the push attempt.
    writeFileSync(join(dir, 'boat.yaml'), 'name: Valkyrie\nmake: App\nmodel: Y\nyear: 2001\nhailingPort: Home\n');
    await simpleGit(dir).add('boat.yaml');
    await simpleGit(dir).commit('app edits boat');

    // Now a normal store write: it commits locally, then tries pull-rebase+push,
    // which conflicts on boat.yaml → status conflict, auto-push paused.
    await store.createRecord('vendor', { name: 'Local Only' }, '', AUTHOR);
    let s = store.syncState();
    expect(s.status).toBe('conflict');
    // The record is still persisted locally (write succeeded).
    expect(store.current().vendors.some((v) => v.id === 'v-local-only')).toBe(true);
    // The remote was NOT clobbered: bare HEAD is still the OTHER clone's commit.
    expect(await headSubject(bare)).toBe('other edits boat');

    // A subsequent write while paused commits locally but does NOT push.
    await store.createRecord('vendor', { name: 'Second Local' }, '', AUTHOR);
    s = store.syncState();
    expect(s.status).toBe('conflict'); // still paused
    expect(store.current().vendors.some((v) => v.id === 'v-second-local')).toBe(true);
    // Remote still untouched.
    expect(await headSubject(bare)).toBe('other edits boat');
  });

  it('OFFLINE: a transport/credential failure sets status offline and does not leak the remote path', async () => {
    const bare = await makeBareDataRepo();
    const { store, dir } = await openStoreOn(bare, 'app');
    // Repoint origin at a non-existent path → push fails at transport.
    await simpleGit(dir).remote(['set-url', 'origin', `file://${dir}-gone/does-not-exist`]);
    await store.createRecord('vendor', { name: 'Whatever' }, '', AUTHOR);
    const s = store.syncState();
    expect(s.status).toBe('offline');
    expect(store.current().vendors.some((v) => v.id === 'v-whatever')).toBe(true);
    // Generic error only — no filesystem path / remote URL leaked.
    if (s.lastError) {
      expect(s.lastError).not.toMatch(/does-not-exist/);
      expect(s.lastError).not.toMatch(/file:\/\//);
    }
  });

  it('a clean pull through the store clears a prior conflict and advances the dataset', async () => {
    const bare = await makeBareDataRepo();
    const { store, dir } = await openStoreOn(bare, 'app');
    // Drive into conflict exactly as above.
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

    // Resolve the conflict out-of-band (as Cowork/CLI would on the working clone):
    // drop the diverging boat edit so the app clone is a strict descendant-free
    // base, then push a NEW remote commit from the other clone for the store to
    // pull cleanly. We reset the app clone onto the remote tip via the tracked
    // upstream (branch-name-agnostic), keeping only the record file untracked.
    const upstream = (await simpleGit(dir).raw(['rev-parse', '--abbrev-ref', '@{u}'])).trim();
    await simpleGit(dir).reset(['--hard', upstream]);

    // The other clone advances the remote with a fresh, non-conflicting change.
    writeFileSync(join(other.dir, 'vendors', 'v-remote-added.md'), '---\nid: v-remote-added\nname: Remote Added\n---\n');
    await other.git.add('.');
    await other.git.commit('other adds vendor');
    await other.git.push();

    const res = await store.pull();
    expect(res.ok).toBe(true);
    expect(store.syncState().status).toBe('ok');
    expect(store.syncState().lastPullAt).toBeInstanceOf(Date);
    // The pull advanced HEAD → reload() refreshed the dataset with the remote add.
    expect(store.current().vendors.some((v) => v.id === 'v-remote-added')).toBe(true);
  });
});
