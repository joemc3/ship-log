import type { Dataset } from './dataset.js';

export const DUE_WINDOW_DAYS = 30;
export type TaskStatus = 'overdue' | 'due';
export type InventoryTaskKind = 'inspect' | 'service' | 'expires';

export interface InventoryTask {
  invId: string;
  kind: InventoryTaskKind;
  date: string;
  status: TaskStatus;
}

function classify(dateStr: string, now: Date): TaskStatus | null {
  // A malformed dateStr would yield Invalid Date -> NaN comparisons -> null (no
  // task), silently dropping it. In practice the schema-level `isoDate` guards
  // both ISO format and calendar validity at load (see schema.ts), so this path
  // only ever sees valid dates; the NaN guard is belt-and-suspenders.
  const date = new Date(`${dateStr}T00:00:00Z`);
  const msPerDay = 86_400_000;
  const days = Math.floor((date.getTime() - now.getTime()) / msPerDay);
  if (days < 0) return 'overdue';
  if (days <= DUE_WINDOW_DAYS) return 'due';
  return null;
}

export function deriveInventoryTasks(ds: Dataset, now: Date): InventoryTask[] {
  const kinds: InventoryTaskKind[] = ['inspect', 'service', 'expires'];
  const tasks: InventoryTask[] = [];
  for (const inv of ds.inventory) {
    for (const kind of kinds) {
      const date = inv[kind];
      if (!date) continue;
      const status = classify(date, now);
      if (status) tasks.push({ invId: inv.id, kind, date, status });
    }
  }
  return tasks;
}

/** Count of items needing attention: maintenance (overdue|due) + inventory tasks. */
export function deriveAttention(ds: Dataset, now: Date): number {
  const maint = ds.maintenance.filter((m) => m.status === 'overdue' || m.status === 'due').length;
  return maint + deriveInventoryTasks(ds, now).length;
}
