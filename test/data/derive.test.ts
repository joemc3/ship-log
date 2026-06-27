import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadDataset } from '../../src/data/dataset.js';
import {
  deriveInventoryTasks, deriveAttention,
  deriveEngineHours, deriveEngineServiceStatuses, deriveEngineServiceTasks, engineView,
} from '../../src/data/derive.js';

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
  it('counts maintenance needing attention plus inventory + engine tasks', async () => {
    const ds = await loadDataset(DEMO);
    const maint = ds.maintenance.filter((m) => m.status === 'overdue' || m.status === 'due').length;
    const inv = deriveInventoryTasks(ds, DEMO_TODAY).length;
    const eng = deriveEngineServiceTasks(ds, DEMO_TODAY).length;
    expect(deriveAttention(ds, DEMO_TODAY)).toBe(maint + inv + eng);
  });
});

function dsWith(engine: unknown, engineHrs: number[]): any {
  return {
    boat: { name: 'T', engine },
    trips: engineHrs.map((h, i) => ({ id: `t-2026-01-0${i + 1}`, date: `2026-01-0${i + 1}`, engineHrs: h, body: '' })),
    maintenance: [], costs: [], vendors: [], inventory: [], manuals: [], quickref: [], conditions: null,
  };
}

const NOW = new Date('2026-06-16T00:00:00Z');

describe('deriveEngineHours', () => {
  it('sums the baseline plus every trip engineHrs', () => {
    const ds = dsWith({ hoursStart: 412 }, [4.1, 1.2, 0.8]);
    expect(deriveEngineHours(ds)).toBeCloseTo(418.1, 5);
  });
  it('treats a missing baseline as 0 and missing engineHrs as 0', () => {
    const ds = dsWith(undefined, [2, 3]);
    expect(deriveEngineHours(ds)).toBe(5);
  });
});

describe('deriveEngineServiceStatuses', () => {
  it('flags an hours-overdue service (clock-independent)', () => {
    const ds = dsWith({ hoursStart: 412, services: [{ id: 'fuel', label: 'Fuel filter', everyHours: 200, lastDoneHours: 205 }] }, [4.1, 1.2, 0.8, 2.4, 0.6]);
    // lifetime = 412 + 9.1 = 421.1; dueAt = 205 + 200 = 405; remaining = -16.1
    const s = deriveEngineServiceStatuses(ds, NOW)[0]!;
    expect(s.status).toBe('overdue');
    expect(s.hoursRemaining).toBeCloseTo(-16.1, 5);
  });
  it('flags an hours-due service within the 10-hr window', () => {
    const ds = dsWith({ hoursStart: 412, services: [{ id: 'fuel', label: 'Fuel', everyHours: 200, lastDoneHours: 225 }] }, [4.1, 1.2, 0.8, 2.4, 0.6]);
    // dueAt = 425; remaining = 3.9 -> due
    expect(deriveEngineServiceStatuses(ds, NOW)[0]!.status).toBe('due');
  });
  it('uses the baseline as the hours anchor when lastDoneHours is absent', () => {
    const ds = dsWith({ hoursStart: 412, services: [{ id: 'x', label: 'X', everyHours: 5 }] }, [4.1, 1.2, 0.8, 2.4, 0.6]);
    // anchor = hoursStart 412; dueAt = 417; lifetime 421.1; remaining -4.1 -> overdue
    expect(deriveEngineServiceStatuses(ds, NOW)[0]!.status).toBe('overdue');
  });
  it('classifies a calendar trigger and clamps month-end overflow', () => {
    const ds = dsWith({ services: [{ id: 'oil', label: 'Oil', everyMonths: 1, lastDoneDate: '2026-01-31' }] }, []);
    const s = deriveEngineServiceStatuses(ds, NOW)[0]!;
    expect(s.dueDate).toBe('2026-02-28'); // Jan 31 + 1 month clamps to Feb 28
    expect(s.status).toBe('overdue');     // due 2026-02-28, now 2026-06-16
  });
  it('leaves a calendar service inactive when there is no lastDoneDate anchor', () => {
    const ds = dsWith({ services: [{ id: 'oil', label: 'Oil', everyMonths: 12 }] }, []);
    const s = deriveEngineServiceStatuses(ds, NOW)[0]!;
    expect(s.status).toBe('ok');
    expect(s.dueDate).toBeUndefined();
  });
  it('takes the worse of the two triggers', () => {
    // hours -> ok (lots left), calendar -> overdue
    const ds = dsWith({ hoursStart: 0, services: [{ id: 'oil', label: 'Oil', everyHours: 1000, lastDoneHours: 0, everyMonths: 1, lastDoneDate: '2026-01-01' }] }, [1]);
    expect(deriveEngineServiceStatuses(ds, NOW)[0]!.status).toBe('overdue');
  });
  it('returns [] when there is no engine block or no services', () => {
    expect(deriveEngineServiceStatuses(dsWith(undefined, [1]), NOW)).toEqual([]);
    expect(deriveEngineServiceStatuses(dsWith({ hoursStart: 1 }, [1]), NOW)).toEqual([]);
  });
});

describe('deriveEngineServiceTasks', () => {
  it('returns only the actionable (non-ok) services', () => {
    const ds = dsWith({ hoursStart: 412, services: [
      { id: 'fuel', label: 'Fuel', everyHours: 200, lastDoneHours: 205 }, // overdue
      { id: 'oil', label: 'Oil', everyHours: 1000, lastDoneHours: 400 },  // ok
    ] }, [4.1, 1.2, 0.8, 2.4, 0.6]);
    const tasks = deriveEngineServiceTasks(ds, NOW);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe('fuel');
  });
});

describe('engineView', () => {
  it('bundles lifetime/baseline + per-service statuses', () => {
    const ds = dsWith({ hoursStart: 412, services: [{ id: 'oil', label: 'Oil', everyHours: 100, lastDoneHours: 380 }] }, [4.1]);
    const v = engineView(ds, NOW);
    expect(v.hours.hoursStart).toBe(412);
    expect(v.hours.lifetime).toBeCloseTo(416.1, 5);
    expect(v.services).toHaveLength(1);
    expect(v.services[0]!.id).toBe('oil');
  });
});
