import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadDataset } from '../../src/data/dataset.js';
import { search } from '../../src/data/search.js';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');

describe('search', () => {
  it('finds a maintenance item by title (case-insensitive)', async () => {
    const ds = await loadDataset(DEMO);
    const hits = search(ds, 'HALYARD');
    expect(hits).toContainEqual(expect.objectContaining({ collection: 'maintenance', id: 'm-jib-halyard' }));
  });

  it('finds a trip by waypoint note text in the body or fields', async () => {
    const ds = await loadDataset(DEMO);
    const hits = search(ds, 'Gull Point');
    expect(hits.some((h) => h.collection === 'trip' && h.id === 't-2024-06-22')).toBe(true);
  });

  it('returns an empty array when nothing matches', async () => {
    const ds = await loadDataset(DEMO);
    expect(search(ds, 'zzzznotfound')).toEqual([]);
  });

  it('does not match on field names (searches values, not keys)', async () => {
    const ds = await loadDataset(DEMO);
    expect(search(ds, 'vendorid')).toEqual([]);
  });

  it('matches text that appears only in the Markdown body', async () => {
    const ds = await loadDataset(DEMO);
    const hits = search(ds, 'strands'); // 'strands' appears only in the m-jib-halyard body
    expect(hits.some((h) => h.collection === 'maintenance' && h.id === 'm-jib-halyard')).toBe(true);
  });
});
