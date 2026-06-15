import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadDataset } from '../../src/data/dataset.js';
import { checkLinkIntegrity } from '../../src/data/links.js';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');

describe('checkLinkIntegrity', () => {
  it('finds no broken links in the demo dataset', async () => {
    const ds = await loadDataset(DEMO);
    expect(checkLinkIntegrity(ds)).toEqual([]);
  });

  it('reports a finding that points at a missing maintenance item', async () => {
    const ds = await loadDataset(DEMO);
    ds.trips[0]!.findings = [{ text: 'X', maintId: 'm-does-not-exist' }];
    const broken = checkLinkIntegrity(ds);
    expect(broken).toContainEqual({ from: 't-2024-06-22', field: 'findings.maintId', target: 'm-does-not-exist' });
  });

  it('reports a cost pointing at a missing vendor', async () => {
    const ds = await loadDataset(DEMO);
    ds.costs[0]!.vendorId = 'v-ghost';
    const broken = checkLinkIntegrity(ds);
    expect(broken).toContainEqual({ from: 'c-jib-halyard', field: 'vendorId', target: 'v-ghost' });
  });

  it('reports a maintenance item pointing at a missing vendor', async () => {
    const ds = await loadDataset(DEMO);
    ds.maintenance[0]!.vendorId = 'v-ghost';
    expect(checkLinkIntegrity(ds)).toContainEqual({ from: 'm-jib-halyard', field: 'vendorId', target: 'v-ghost' });
  });

  it('reports a maintenance item pointing at a missing originating trip', async () => {
    const ds = await loadDataset(DEMO);
    ds.maintenance[0]!.fromTripId = 't-ghost';
    expect(checkLinkIntegrity(ds)).toContainEqual({ from: 'm-jib-halyard', field: 'fromTripId', target: 't-ghost' });
  });
});
