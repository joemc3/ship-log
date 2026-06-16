import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import sharp from 'sharp';
import { ShipStore } from '../../src/server/store.js';
import { makeDataRepo } from './helpers.js';

const NOW = () => new Date('2024-07-01T00:00:00Z');
const AUTHOR = { name: 'Cap', email: 'cap@boat.test' };

describe('ShipStore', () => {
  it('creates a record, commits it, and reflects it in current()', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const rec = await store.createRecord('vendor', { name: 'Rigging Pros', phone: '555' }, 'Great service.', AUTHOR);
    expect(rec.id).toBe('v-rigging-pros');
    expect(store.current().vendors.some((v) => v.id === 'v-rigging-pros')).toBe(true);
    const line = (await simpleGit(dir).raw(['log', '-1', '--format=%an|%s'])).trim();
    expect(line).toBe('Cap|add vendor v-rigging-pros');
  });

  it('derives a trip id from its date and suffixes a same-date collision', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const a = await store.createRecord('trip', { date: '2024-08-01' }, 'first', AUTHOR);
    const b = await store.createRecord('trip', { date: '2024-08-01' }, 'second', AUTHOR);
    expect(a.id).toBe('t-2024-08-01');
    expect(b.id).toBe('t-2024-08-01-2');
  });

  it('rejects an invalid create with 400 and writes nothing', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const before = store.current().trips.length;
    await expect(store.createRecord('trip', { date: 'someday' }, '', AUTHOR)).rejects.toMatchObject({ status: 400 });
    expect(store.current().trips.length).toBe(before);
  });

  it('updates a record and 404s an unknown id', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const rec = await store.updateRecord('trip', 't-2024-06-22', { title: 'Renamed', body: 'New narrative.' }, AUTHOR);
    expect(rec.title).toBe('Renamed');
    expect(rec.body).toBe('New narrative.');
    await expect(store.updateRecord('trip', 't-nope', { title: 'x' }, AUTHOR)).rejects.toMatchObject({ status: 404 });
  });

  it('marks maintenance complete, defaulting the date to today; store does NOT redact', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const rec = await store.completeMaintenance('m-jib-halyard', { note: 'New halyard run.' }, AUTHOR);
    expect(rec.status).toBe('done');
    expect(rec.completed).toBe('2024-07-01'); // from NOW
    expect(rec.costEst).toBe(95);             // unredacted at the store layer
    expect(String(rec.body)).toContain('## Completed 2024-07-01');
    expect(String(rec.body)).toContain('New halyard run.');
  });

  it('deletes a record and commits the removal', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    await store.deleteRecord('trip', 't-2024-06-22', AUTHOR);
    expect(store.current().trips.some((t) => t.id === 't-2024-06-22')).toBe(false);
    // The removed file is no longer tracked; other trips in the (enriched) demo
    // dataset remain committed.
    const tracked = (await simpleGit(dir).raw(['ls-files', 'trips'])).trim();
    expect(tracked).not.toContain('t-2024-06-22.md');
  });

  it('serializes concurrent writes (single writer, unique ids)', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const [a, b, c] = await Promise.all([
      store.createRecord('trip', { date: '2024-09-01' }, 'a', AUTHOR),
      store.createRecord('trip', { date: '2024-09-01' }, 'b', AUTHOR),
      store.createRecord('trip', { date: '2024-09-01' }, 'c', AUTHOR),
    ]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(store.current().trips.filter((t) => t.id.startsWith('t-2024-09-01')).length).toBe(3);
  });

  it('keeps the queue usable after an op rejects', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    // An in-queue rejection (unknown id → 404 raised inside the queued op).
    await expect(store.updateRecord('trip', 't-nope', { title: 'x' }, AUTHOR)).rejects.toMatchObject({ status: 404 });
    // The chain must not be poisoned: a following write still runs.
    const rec = await store.createRecord('vendor', { name: 'After Failure' }, '', AUTHOR);
    expect(rec.id).toBe('v-after-failure');
    expect(store.current().vendors.some((v) => v.id === 'v-after-failure')).toBe(true);
  });

  it('saves a compressed photo and commits it', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const png = await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const { ref } = await store.savePhoto(png, 'image/png', AUTHOR);
    expect(ref).toMatch(/^photos\/[0-9a-f]{12}\.jpg$/);
    expect((await simpleGit(dir).raw(['ls-files', ref])).trim()).toBe(ref);
  });

  it('persists WITHOUT committing when the data dir is not a git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-norepo-'));
    writeFileSync(join(dir, 'boat.yaml'), 'name: Scratch\n'); // minimal valid dataset
    const store = await ShipStore.open(dir, { now: NOW });
    const rec = await store.createRecord('vendor', { name: 'No Repo' }, '', AUTHOR);
    expect(rec.id).toBe('v-no-repo');
    expect(store.current().vendors.some((v) => v.id === 'v-no-repo')).toBe(true);
    const onDisk = await readFile(join(dir, 'vendors', 'v-no-repo.md'), 'utf8');
    expect(onDisk).toContain('id: v-no-repo'); // file written even with no commit
  });
});
