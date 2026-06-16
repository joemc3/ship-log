import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDataset } from '../../src/data/dataset.js';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');

describe('loadDataset', () => {
  it('loads every collection from the demo dataset', async () => {
    const ds = await loadDataset(DEMO);
    expect(ds.boat.name).toBe('Valkyrie');
    expect(ds.trips.map((t) => t.id)).toContain('t-2024-06-22');
    expect(ds.maintenance.map((m) => m.id)).toContain('m-jib-halyard');
    expect(ds.costs.map((c) => c.id)).toContain('c-jib-halyard');
    expect(ds.vendors.map((v) => v.id)).toContain('v-sailloft');
    expect(ds.inventory.map((i) => i.id)).toContain('inv-fire-ext');
    expect(ds.inventory.map((i) => i.id)).toContain('inv-flares');
    expect(ds.manuals.map((m) => m.id)).toContain('man-engine');
    expect(ds.quickref.map((q) => q.id)).toContain('qr-reef');
  });

  it('attaches the body narrative to records', async () => {
    const ds = await loadDataset(DEMO);
    const trip = ds.trips.find((t) => t.id === 't-2024-06-22')!;
    expect(trip.body).toContain('First proper sail');
  });

  it('throws a descriptive error on a schema-invalid record', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-'));
    mkdirSync(join(dir, 'trips'), { recursive: true });
    writeFileSync(join(dir, 'boat.yaml'), 'name: Test\n');
    writeFileSync(join(dir, 'trips', 't-bad.md'), '---\nid: t-bad\n---\nno date here\n');
    await expect(loadDataset(dir)).rejects.toThrow(/t-bad/);
  });

  it('returns an empty array for a collection whose directory is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-'));
    writeFileSync(join(dir, 'boat.yaml'), 'name: Test\n');
    const ds = await loadDataset(dir);
    expect(ds.trips).toEqual([]);
    expect(ds.maintenance).toEqual([]);
  });

  it('throws when quickref.yaml is present but schema-invalid (not silently ignored)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-'));
    writeFileSync(join(dir, 'boat.yaml'), 'name: Test\n');
    writeFileSync(join(dir, 'quickref.yaml'), '- title: missing the required id\n');
    await expect(loadDataset(dir)).rejects.toThrow();
  });
});
