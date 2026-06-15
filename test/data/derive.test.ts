import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadDataset } from '../../src/data/dataset.js';
import { deriveInventoryTasks, deriveAttention } from '../../src/data/derive.js';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');

describe('deriveInventoryTasks', () => {
  it('flags an expired item as overdue and a soon-due inspection as due', async () => {
    const ds = await loadDataset(DEMO);
    const now = new Date('2024-07-01T00:00:00Z');
    const tasks = deriveInventoryTasks(ds, now);
    expect(tasks).toContainEqual({ invId: 'inv-flares', kind: 'expires', date: '2024-05-01', status: 'overdue' });
    expect(tasks).toContainEqual({ invId: 'inv-fire-ext', kind: 'inspect', date: '2024-07-10', status: 'due' });
  });

  it('produces no task when the date is far in the future', async () => {
    const ds = await loadDataset(DEMO);
    const now = new Date('2024-01-01T00:00:00Z'); // both dates >30 days out
    const tasks = deriveInventoryTasks(ds, now);
    expect(tasks.find((t) => t.invId === 'inv-fire-ext')).toBeUndefined();
  });
});

describe('deriveAttention', () => {
  it('counts maintenance needing attention plus inventory tasks', async () => {
    const ds = await loadDataset(DEMO);
    // demo maintenance is 'done' (0); inventory at this clock yields 2 tasks
    const now = new Date('2024-07-01T00:00:00Z');
    expect(deriveAttention(ds, now)).toBe(2);
  });
});
