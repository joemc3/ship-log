import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadDataset } from '../../src/data/index.js';
import { redactDataset } from '../../src/server/redact.js';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');

describe('redactDataset', () => {
  it('returns the same dataset reference for an owner (no copy)', async () => {
    const ds = await loadDataset(DEMO);
    expect(redactDataset(ds, 'owner')).toBe(ds);
  });

  it('empties owner-only collections and strips monetary fields for crew', async () => {
    const ds = await loadDataset(DEMO);
    const view = redactDataset(ds, 'crew');
    expect(view.costs).toEqual([]);
    expect(view.maintenance.every((m) => !('costEst' in m))).toBe(true);
  });

  it('treats guest the same as crew', async () => {
    const ds = await loadDataset(DEMO);
    const view = redactDataset(ds, 'guest');
    expect(view.costs).toEqual([]);
    expect(view.maintenance.every((m) => !('costEst' in m))).toBe(true);
  });

  it('does not mutate the original dataset', async () => {
    const ds = await loadDataset(DEMO);
    redactDataset(ds, 'crew');
    expect(ds.costs.length).toBeGreaterThan(0);
    expect(ds.maintenance.some((m) => 'costEst' in m)).toBe(true);
  });
});
