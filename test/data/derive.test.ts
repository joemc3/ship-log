import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadDataset } from '../../src/data/dataset.js';
import { deriveInventoryTasks, deriveAttention } from '../../src/data/derive.js';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');

// The demo dataset is dated relative to 2026-06-16 (its "today"); these tests
// inject that same clock so the derived overdue/due ranges are deterministic.
const DEMO_TODAY = new Date('2026-06-16T00:00:00Z');

describe('deriveInventoryTasks', () => {
  it('flags an expired item as overdue and a soon-due inspection as due', async () => {
    const ds = await loadDataset(DEMO);
    const tasks = deriveInventoryTasks(ds, DEMO_TODAY);
    // inv-flares expired before today -> overdue; inv-fire-ext inspection is
    // within the 30-day due window -> due.
    expect(tasks).toContainEqual({ invId: 'inv-flares', kind: 'expires', date: '2026-04-01', status: 'overdue' });
    expect(tasks).toContainEqual({ invId: 'inv-fire-ext', kind: 'inspect', date: '2026-07-01', status: 'due' });
  });

  it('produces no task when the date is far in the future', async () => {
    const ds = await loadDataset(DEMO);
    const now = new Date('2025-01-01T00:00:00Z'); // well before any demo date
    const tasks = deriveInventoryTasks(ds, now);
    expect(tasks.find((t) => t.invId === 'inv-fire-ext')).toBeUndefined();
  });
});

describe('deriveAttention', () => {
  it('counts maintenance needing attention plus inventory tasks', async () => {
    const ds = await loadDataset(DEMO);
    // At the demo's own clock the enriched dataset is built to span the full
    // range; this asserts the two derived sources sum correctly.
    const maint = ds.maintenance.filter((m) => m.status === 'overdue' || m.status === 'due').length;
    const inv = deriveInventoryTasks(ds, DEMO_TODAY).length;
    expect(deriveAttention(ds, DEMO_TODAY)).toBe(maint + inv);
  });
});
