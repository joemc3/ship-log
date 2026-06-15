import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadDataset, MONETARY_FIELDS, OWNER_ONLY_COLLECTIONS } from '../../src/data/index.js';
import { redactDataset, DATASET_KEY } from '../../src/server/redact.js';

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

  it('every MONETARY_FIELDS key has a DATASET_KEY mapping', () => {
    for (const collection of Object.keys(MONETARY_FIELDS)) {
      expect(DATASET_KEY[collection], `MONETARY_FIELDS["${collection}"] has no DATASET_KEY entry`).toBeDefined();
    }
  });

  it('every OWNER_ONLY_COLLECTIONS entry has a DATASET_KEY mapping', () => {
    for (const collection of OWNER_ONLY_COLLECTIONS) {
      expect(DATASET_KEY[collection], `OWNER_ONLY_COLLECTIONS["${collection}"] has no DATASET_KEY entry`).toBeDefined();
    }
  });
});
