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

/** "Due soon" window for hour-based engine service: hrs-remaining ≤ this ⇒ due. */
export const ENGINE_DUE_WINDOW_HOURS = 10;

export interface EngineServiceStatus {
  id: string;
  label: string;
  everyHours?: number;
  everyMonths?: number;
  lastDoneHours?: number;
  lastDoneDate?: string;
  status: 'ok' | 'due' | 'overdue';
  hoursRemaining?: number; // negative ⇒ overdue by that many hours
  dueDate?: string;
  daysRemaining?: number;  // negative ⇒ overdue by that many days
}

/** EngineServiceStatus narrowed to an actionable task. */
export type EngineServiceTask = EngineServiceStatus & { status: 'due' | 'overdue' };

export interface EngineView {
  hours: { lifetime: number; hoursStart: number };
  services: EngineServiceStatus[];
}

/** Lifetime engine hours = baseline (boat.engine.hoursStart) + Σ trip.engineHrs. */
export function deriveEngineHours(ds: Dataset): number {
  const start = ds.boat.engine?.hoursStart ?? 0;
  return ds.trips.reduce((sum, t) => sum + (t.engineHrs ?? 0), start);
}

/** Add whole months to an ISO date (UTC), clamping a day overflow to the target
 *  month's last day (Jan 31 + 1 month → Feb 28/29). Returns an ISO date string. */
function addMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

const STATUS_RANK = { ok: 0, due: 1, overdue: 2 } as const;
function worse(a: 'ok' | 'due' | 'overdue', b: 'ok' | 'due' | 'overdue'): 'ok' | 'due' | 'overdue' {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/** Full per-service engine status (one entry per defined service, incl. `ok`). */
export function deriveEngineServiceStatuses(ds: Dataset, now: Date): EngineServiceStatus[] {
  const engine = ds.boat.engine;
  if (!engine?.services?.length) return [];
  const lifetime = deriveEngineHours(ds);
  const start = engine.hoursStart ?? 0;
  const msPerDay = 86_400_000;

  return engine.services.map((s) => {
    const out: EngineServiceStatus = {
      id: s.id,
      label: s.label,
      ...(s.everyHours !== undefined ? { everyHours: s.everyHours } : {}),
      ...(s.everyMonths !== undefined ? { everyMonths: s.everyMonths } : {}),
      ...(s.lastDoneHours !== undefined ? { lastDoneHours: s.lastDoneHours } : {}),
      ...(s.lastDoneDate !== undefined ? { lastDoneDate: s.lastDoneDate } : {}),
      status: 'ok',
    };
    let status: 'ok' | 'due' | 'overdue' = 'ok';

    if (s.everyHours !== undefined) {
      const remaining = (s.lastDoneHours ?? start) + s.everyHours - lifetime;
      out.hoursRemaining = remaining;
      status = worse(status, remaining < 0 ? 'overdue' : remaining <= ENGINE_DUE_WINDOW_HOURS ? 'due' : 'ok');
    }
    if (s.everyMonths !== undefined && s.lastDoneDate !== undefined) {
      const dueDate = addMonths(s.lastDoneDate, s.everyMonths);
      const days = Math.floor((new Date(`${dueDate}T00:00:00Z`).getTime() - now.getTime()) / msPerDay);
      out.dueDate = dueDate;
      out.daysRemaining = days;
      status = worse(status, days < 0 ? 'overdue' : days <= DUE_WINDOW_DAYS ? 'due' : 'ok');
    }
    out.status = status;
    return out;
  });
}

/** The actionable (non-ok) engine services. */
export function deriveEngineServiceTasks(ds: Dataset, now: Date): EngineServiceTask[] {
  return deriveEngineServiceStatuses(ds, now).filter(
    (s): s is EngineServiceTask => s.status !== 'ok',
  );
}

/** The full engine read view: lifetime/baseline hours + per-service statuses. */
export function engineView(ds: Dataset, now: Date): EngineView {
  return {
    hours: { lifetime: deriveEngineHours(ds), hoursStart: ds.boat.engine?.hoursStart ?? 0 },
    services: deriveEngineServiceStatuses(ds, now),
  };
}

/** Count of items needing attention: maintenance (overdue|due) + inventory tasks + engine service. */
export function deriveAttention(ds: Dataset, now: Date): number {
  const maint = ds.maintenance.filter((m) => m.status === 'overdue' || m.status === 'due').length;
  return maint + deriveInventoryTasks(ds, now).length + deriveEngineServiceTasks(ds, now).length;
}
