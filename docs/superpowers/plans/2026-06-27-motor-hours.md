# Motor Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track lifetime "hours on the motor" (per-trip `engineHrs` + a baseline) and nag about recurring engine service (oil, impeller, fuel filter…) when it comes due by hours run *or* calendar time, whichever comes first.

**Architecture:** A self-contained `engine` block on `boat.yaml` (baseline `hoursStart` + a `services[]` schedule). Pure derive functions (mirroring the existing inventory-task pattern) compute lifetime hours and per-service due/overdue status, feeding the existing attention badge. A new read route `GET /api/engine` serves the view; a narrow crew+owner write `POST /api/engine/services/:id/log` re-arms a service by editing `boat.yaml` (comment-preserving). The UI adds an Engine card to the Maintenance page.

**Tech Stack:** TypeScript (ESM, Node 20+), Zod 4, `yaml` 2.9 (Document API for comment-preserving edits), Express 5, simple-git, Vitest 4 (server + jsdom UI projects), React 18.

Design spec: `docs/superpowers/specs/2026-06-24-motor-hours-design.md`.

## Global Constraints

- **TDD always:** failing test first, then minimal implementation. `npm test` runs two Vitest projects (`server` node env, `ui` jsdom env). `npm run typecheck` checks BOTH `tsconfig.json` (server, excludes `src/ui`) and `tsconfig.ui.json` (UI).
- **Non-monetary feature:** engine data carries NO cost. Do **not** touch `src/data/monetary.ts`. Never add a monetary field to the engine schema. The `redaction-golden` test must stay green (it deep-walks every non-owner response asserting no monetary key).
- **Derive purity:** every derive function takes an injected `now: Date`; never call argless `new Date()` inside `src/data/`.
- **Data layer boundary:** the server imports the data layer ONLY from `src/data/index.js`. One responsibility per file.
- **YAML dates stay strings:** the loader parses `boat.yaml` with the `yaml` package (YAML 1.2 core), so a bare `2026-06-27` is a string. The comment-preserving edit (`parseDocument`/`toString`) uses the same core schema, so round-tripped ISO dates stay unquoted strings — keep it that way.
- **SCHEMA.md is mirrored:** authored canonically in `data-template/SCHEMA.md`, **byte-copied** to `demo/SCHEMA.md`. After any edit run `cp data-template/SCHEMA.md demo/SCHEMA.md`. The `schema-doc` / `p3-doc-drift-golden` / `cowork-docs-mirror` tests enforce byte-identity.
- **Doc-upkeep rule:** every change verifies `README.md` and `CLAUDE.md` are still accurate and updates them (Task 10).
- **Demo "today" clocks:** `test/data/derive.test.ts` injects `DEMO_TODAY = 2026-06-16`; the server test harness (`test/server/helpers.ts`) injects `FIXED_NOW = 2024-07-01`. Calendar-based status differs by clock; **hours-based** status is clock-independent — anchor deterministic assertions on the hours trigger.
- **Commit** after each task (or each green step). Use the repo's `feat(...)`/`test(...)`/`docs(...)` message convention.

---

### Task 1: Engine schema on `boat.yaml`

**Files:**
- Modify: `src/data/schema.ts` (add `engineServiceSchema`, `engineSchema`, `engine` field on `boatSchema`)
- Test: `test/data/schema.test.ts`

**Interfaces:**
- Produces: `engineServiceSchema`, `engineSchema`, `type EngineService`, `type Engine`; `boatSchema` gains optional `engine: engineSchema`.

- [ ] **Step 1: Write the failing test** — append to `test/data/schema.test.ts`:

```ts
import { boatSchema, engineSchema } from '../../src/data/schema.js';

describe('engine schema (boat.yaml engine block)', () => {
  const valid = {
    hoursStart: 412,
    services: [
      { id: 'oil', label: 'Engine oil & filter', everyHours: 100, everyMonths: 12, lastDoneHours: 380, lastDoneDate: '2025-08-01' },
      { id: 'impeller', label: 'Raw-water impeller', everyMonths: 24, lastDoneDate: '2024-05-10' },
    ],
  };

  it('accepts a well-formed engine block', () => {
    expect(engineSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a boat with no engine block (optional)', () => {
    expect(boatSchema.safeParse({ name: 'Test' }).success).toBe(true);
  });

  it('accepts a boat carrying the engine block', () => {
    expect(boatSchema.safeParse({ name: 'Test', engine: valid }).success).toBe(true);
  });

  it('rejects a non-positive interval, a negative baseline, and a malformed lastDoneDate', () => {
    expect(engineSchema.safeParse({ hoursStart: -1 }).success).toBe(false);
    expect(engineSchema.safeParse({ services: [{ id: 'x', label: 'X', everyHours: 0 }] }).success).toBe(false);
    expect(engineSchema.safeParse({ services: [{ id: 'x', label: 'X', lastDoneDate: '2025-13-40' }] }).success).toBe(false);
    expect(engineSchema.safeParse({ services: [{ label: 'no id' }] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/data/schema.test.ts`
Expected: FAIL — `engineSchema` is not exported.

- [ ] **Step 3: Implement** — in `src/data/schema.ts`, insert immediately ABOVE `export const boatSchema = z.object({`:

```ts
export const engineServiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  everyHours: z.number().positive().optional(),
  everyMonths: z.number().positive().optional(),
  lastDoneHours: z.number().nonnegative().optional(),
  lastDoneDate: isoDate.optional(),
});
export type EngineService = z.infer<typeof engineServiceSchema>;

export const engineSchema = z.object({
  hoursStart: z.number().nonnegative().optional(), // baseline meter reading; treated as 0 when absent
  services: z.array(engineServiceSchema).optional(),
});
export type Engine = z.infer<typeof engineSchema>;
```

Then add this line inside the `boatSchema` object literal (e.g. directly after the `specs:` line):

```ts
  engine: engineSchema.optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/data/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/schema.ts test/data/schema.test.ts
git commit -m "feat(data): add optional engine block (baseline + service schedule) to boat schema"
```

---

### Task 2: Derive lifetime hours, service status, tasks, and engine view

**Files:**
- Modify: `src/data/derive.ts`
- Test: `test/data/derive.test.ts`

**Interfaces:**
- Consumes: `Dataset` (with `boat.engine`, `trips[].engineHrs`), the existing `DUE_WINDOW_DAYS`.
- Produces:
  - `ENGINE_DUE_WINDOW_HOURS: number` (= 10)
  - `interface EngineServiceStatus { id; label; everyHours?; everyMonths?; lastDoneHours?; lastDoneDate?; status: 'ok'|'due'|'overdue'; hoursRemaining?; dueDate?; daysRemaining? }`
  - `type EngineServiceTask = EngineServiceStatus & { status: 'due' | 'overdue' }`
  - `interface EngineView { hours: { lifetime: number; hoursStart: number }; services: EngineServiceStatus[] }`
  - `deriveEngineHours(ds): number`
  - `deriveEngineServiceStatuses(ds, now): EngineServiceStatus[]`
  - `deriveEngineServiceTasks(ds, now): EngineServiceTask[]`
  - `engineView(ds, now): EngineView`
  - `deriveAttention` now also adds `deriveEngineServiceTasks(...).length`

- [ ] **Step 1: Write the failing test** — append to `test/data/derive.test.ts`:

```ts
import {
  deriveEngineHours, deriveEngineServiceStatuses, deriveEngineServiceTasks, engineView,
} from '../../src/data/derive.js';

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
```

Also REWRITE the existing `deriveAttention` test in this file so it stays correct once engine data is added to the demo (Task 3). Replace the body of the `it('counts maintenance needing attention plus inventory tasks', ...)` test with:

```ts
  it('counts maintenance needing attention plus inventory + engine tasks', async () => {
    const ds = await loadDataset(DEMO);
    const maint = ds.maintenance.filter((m) => m.status === 'overdue' || m.status === 'due').length;
    const inv = deriveInventoryTasks(ds, DEMO_TODAY).length;
    const eng = deriveEngineServiceTasks(ds, DEMO_TODAY).length;
    expect(deriveAttention(ds, DEMO_TODAY)).toBe(maint + inv + eng);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/data/derive.test.ts`
Expected: FAIL — `deriveEngineHours` (and friends) not exported.

- [ ] **Step 3: Implement** — append to `src/data/derive.ts` (after the existing `deriveAttention`), then update `deriveAttention`:

```ts
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
```

Then change `deriveAttention` to:

```ts
/** Count of items needing attention: maintenance (overdue|due) + inventory tasks + engine service. */
export function deriveAttention(ds: Dataset, now: Date): number {
  const maint = ds.maintenance.filter((m) => m.status === 'overdue' || m.status === 'due').length;
  return maint + deriveInventoryTasks(ds, now).length + deriveEngineServiceTasks(ds, now).length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/data/derive.test.ts`
Expected: PASS (all engine tests + the rewritten attention test). At this point the demo has no engine block yet, so `eng === 0`.

- [ ] **Step 5: Commit**

```bash
git add src/data/derive.ts test/data/derive.test.ts
git commit -m "feat(data): derive lifetime engine hours + hours/calendar service status; fold into attention"
```

---

### Task 3: Demo + data-template engine data

**Files:**
- Modify: `demo/boat.yaml` (add a realistic `engine` block)
- Modify: `data-template/boat.yaml` (add a minimal placeholder `engine` block)
- Modify: `test/server/data.test.ts` (the `/api/derived` attention count: 4 → 5)
- Test: `test/data/data-template.test.ts` (assert the placeholder engine block), `test/data/derive.test.ts` (a demo-anchored engine assertion)

**Interfaces:**
- Consumes: `deriveEngineHours`, `deriveEngineServiceStatuses` (Task 2).
- Produces: demo dataset now has `boat.engine` with a deterministically **hours-overdue** `fuel-filter` service (clock-independent).

- [ ] **Step 1: Write the failing tests.**

Append to `test/data/derive.test.ts`:

```ts
describe('engine derivation over the demo dataset', () => {
  it('computes lifetime hours and flags the demo fuel-filter as hours-overdue', async () => {
    const ds = await loadDataset(DEMO);
    expect(deriveEngineHours(ds)).toBeCloseTo(421.1, 5); // 412 baseline + 9.1 logged
    const statuses = deriveEngineServiceStatuses(ds, DEMO_TODAY);
    const fuel = statuses.find((s) => s.id === 'fuel-filter')!;
    expect(fuel.status).toBe('overdue');
    expect(fuel.hoursRemaining! < 0).toBe(true);
  });
});
```

Append to `test/data/data-template.test.ts` (inside the existing top-level `describe`):

```ts
  it('carries a minimal, empty engine block (shape, no schedule)', async () => {
    const ds = await loadDataset(TEMPLATE);
    expect(ds.boat.engine).toEqual({ hoursStart: 0, services: [] });
  });
```

> Note: `test/data/data-template.test.ts` already resolves the template dir; reuse its existing constant (it is named `TEMPLATE` there — confirm the local name and match it).

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/data/derive.test.ts test/data/data-template.test.ts`
Expected: FAIL — demo/template have no engine block yet.

- [ ] **Step 3: Implement the data.**

In `demo/boat.yaml`, add this block (place after the `specs:` map, before `welcome:`):

```yaml
engine:
  hoursStart: 412.0
  services:
    - id: oil
      label: Engine oil & filter
      everyHours: 100
      everyMonths: 12
      lastDoneHours: 380
      lastDoneDate: 2025-08-01
    - id: impeller
      label: Raw-water impeller
      everyMonths: 24
      lastDoneDate: 2024-05-10
    - id: fuel-filter
      label: Primary fuel filter
      everyHours: 200
      lastDoneHours: 205
```

In `data-template/boat.yaml`, add (placement consistent with its existing layout):

```yaml
engine:
  hoursStart: 0
  services: []
```

In `test/server/data.test.ts`, update the `/api/derived` assertion. The demo's hours-overdue `fuel-filter` adds exactly one engine task at `FIXED_NOW` (2024-07-01), where `oil`/`impeller` calendar triggers are far in the future:

```ts
    expect(res.body.attention).toBe(5); // was 4: + the hours-overdue fuel-filter engine service
    expect(res.body.inventoryTasks).toHaveLength(0);
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/data/derive.test.ts test/data/data-template.test.ts test/server/data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo/boat.yaml data-template/boat.yaml test/data/derive.test.ts test/data/data-template.test.ts test/server/data.test.ts
git commit -m "feat(data): seed demo engine schedule (M-25) + empty template engine block"
```

---

### Task 4: Comment-preserving `boat.yaml` edit helper

**Files:**
- Modify: `src/data/write.ts` (add `applyEngineServiceLog`)
- Test: `test/data/write.test.ts`

**Interfaces:**
- Produces: `applyEngineServiceLog(rawYaml: string, serviceId: string, patch: { lastDoneHours: number; lastDoneDate: string }): string | null` — updates the matching service's `lastDoneHours`/`lastDoneDate` in place (preserving comments + formatting + key order), returns the new YAML text; returns `null` when there is no `engine.services` sequence or no service with that id.

- [ ] **Step 1: Write the failing test** — append to `test/data/write.test.ts`:

```ts
import { applyEngineServiceLog } from '../../src/data/write.js';

describe('applyEngineServiceLog', () => {
  const raw = [
    'name: Test',
    'engine:',
    '  hoursStart: 412.0',
    '  services:',
    '    - id: oil',
    '      label: Engine oil & filter # the main one',
    '      everyHours: 100',
    '    - id: fuel-filter',
    '      label: Primary fuel filter',
    '      everyHours: 200',
    '',
  ].join('\n');

  it('sets lastDoneHours/lastDoneDate on the matching service and preserves comments', () => {
    const out = applyEngineServiceLog(raw, 'oil', { lastDoneHours: 421.1, lastDoneDate: '2026-06-27' })!;
    expect(out).toContain('lastDoneHours: 421.1');
    expect(out).toContain('lastDoneDate: 2026-06-27');
    expect(out).toContain('# the main one');     // comment survived
    expect(out).toContain('id: fuel-filter');    // the other service is intact
    // Round-trips: a date stays an unquoted string under the core schema.
    expect(out).not.toContain("lastDoneDate: '2026-06-27'");
  });

  it('returns null for an unknown service id', () => {
    expect(applyEngineServiceLog(raw, 'nope', { lastDoneHours: 1, lastDoneDate: '2026-06-27' })).toBeNull();
  });

  it('returns null when there is no engine.services sequence', () => {
    expect(applyEngineServiceLog('name: Test\n', 'oil', { lastDoneHours: 1, lastDoneDate: '2026-06-27' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/data/write.test.ts`
Expected: FAIL — `applyEngineServiceLog` not exported.

- [ ] **Step 3: Implement.**

At the top of `src/data/write.ts`, add an import:

```ts
import { parseDocument, isMap, isSeq } from 'yaml';
```

Append the function at the end of `src/data/write.ts`:

```ts
/**
 * Update one engine service's `lastDoneHours`/`lastDoneDate` inside a raw boat.yaml
 * text, PRESERVING comments, key order, and formatting (uses the yaml Document
 * API, not a parse→stringify round-trip). Returns the new YAML text, or `null`
 * when there is no `engine.services` sequence or no service with `serviceId`.
 */
export function applyEngineServiceLog(
  rawYaml: string,
  serviceId: string,
  patch: { lastDoneHours: number; lastDoneDate: string },
): string | null {
  const doc = parseDocument(rawYaml);
  const services = doc.getIn(['engine', 'services']);
  if (!isSeq(services)) return null;
  const node = services.items.find((item) => isMap(item) && item.get('id') === serviceId);
  if (!node || !isMap(node)) return null;
  node.set('lastDoneHours', patch.lastDoneHours);
  node.set('lastDoneDate', patch.lastDoneDate);
  return doc.toString();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/data/write.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/write.ts test/data/write.test.ts
git commit -m "feat(data): comment-preserving boat.yaml engine-service log helper"
```

---

### Task 5: `ShipStore.logEngineService` writer

**Files:**
- Modify: `src/server/store.ts`
- Test: `test/server/store.test.ts`

**Interfaces:**
- Consumes: `applyEngineServiceLog`, `deriveEngineHours`, `boatSchema` (from `../data/index.js`); `parse as parseYaml` (from `yaml`); `readFile` (from `node:fs/promises`).
- Produces: `ShipStore.logEngineService(id: string, opts: { atHours?: unknown; on?: unknown; note?: unknown }, author: CommitAuthor): Promise<void>` — validates inputs, defaults `atHours` to the rounded current lifetime hours and `on` to today, edits `boat.yaml`, commits **only** `boat.yaml`, reloads, and syncs. Throws `WriteError(404)` for an unknown id, `WriteError(400)` for bad inputs.

- [ ] **Step 1: Write the failing test** — append to `test/server/store.test.ts` (match the file's existing harness — it builds a store over `makeDataRepo()` with an `AUTHOR`; reuse those helpers/names):

```ts
  it('logs an engine service: re-arms it, commits ONLY boat.yaml', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: () => new Date('2024-07-01T00:00:00Z'), sync: false });

    await store.logEngineService('fuel-filter', {}, AUTHOR);

    const svc = store.current().boat.engine!.services!.find((s) => s.id === 'fuel-filter')!;
    expect(svc.lastDoneHours).toBeCloseTo(421.1, 5); // default = current lifetime (rounded to 0.1)
    expect(svc.lastDoneDate).toBe('2024-07-01');

    // GOLDEN: the commit touched ONLY boat.yaml.
    const changed = (await simpleGit(dir).raw(['show', '--name-only', '--format=', 'HEAD'])).trim();
    expect(changed).toBe('boat.yaml');
  });

  it('404s an unknown engine service and 400s a negative atHours', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: () => new Date('2024-07-01T00:00:00Z'), sync: false });
    await expect(store.logEngineService('nope', {}, AUTHOR)).rejects.toMatchObject({ status: 404 });
    await expect(store.logEngineService('fuel-filter', { atHours: -3 }, AUTHOR)).rejects.toMatchObject({ status: 400 });
  });
```

> If `store.test.ts` does not already import `simpleGit`, add `import { simpleGit } from 'simple-git';` at the top (the other golden tests in this file already use it, so it is likely present).

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/server/store.test.ts`
Expected: FAIL — `logEngineService` is not a function.

- [ ] **Step 3: Implement.**

In `src/server/store.ts`:

1. Change the fs import to include `readFile`:

```ts
import { writeFile, rm, mkdir, readFile } from 'node:fs/promises';
```

2. Add a `yaml` import near the top:

```ts
import { parse as parseYaml } from 'yaml';
```

3. Extend the data-layer import to add the three names:

```ts
import {
  loadDataset, type Dataset,
  collectionSchemas, createSchemas, maintenanceSchema, isoDate, boatSchema,
  deriveId, recordPath, toFileContents, COLLECTION_DIR, type CollectionName,
  applyEngineServiceLog, deriveEngineHours,
} from '../data/index.js';
```

4. Add the method (e.g. right after `completeMaintenance`):

```ts
  async logEngineService(
    id: string,
    opts: { atHours?: unknown; on?: unknown; note?: unknown },
    author: CommitAuthor,
  ): Promise<void> {
    return this.enqueue(async () => {
      if (
        opts.atHours !== undefined &&
        (typeof opts.atHours !== 'number' || !Number.isFinite(opts.atHours) || opts.atHours < 0)
      ) {
        throw new WriteError('atHours must be a non-negative number', 400);
      }
      const on = opts.on === undefined ? isoToday(this.now()) : opts.on;
      if (!isoDate.safeParse(on).success) {
        throw new WriteError('on must be an ISO date (YYYY-MM-DD)', 400);
      }
      if (opts.note !== undefined && typeof opts.note !== 'string') {
        throw new WriteError('note must be a string', 400);
      }
      const atHours =
        opts.atHours === undefined
          ? Math.round(deriveEngineHours(this.snapshot) * 10) / 10
          : opts.atHours;

      const abs = join(this.dir, 'boat.yaml');
      const raw = await readFile(abs, 'utf8');
      const updated = applyEngineServiceLog(raw, id, { lastDoneHours: atHours, lastDoneDate: on as string });
      if (updated === null) throw new WriteError('not found', 404);

      // Defensive: the resulting boat.yaml must still validate (gives 400, not a crash on reload).
      const reparsed = boatSchema.safeParse(parseYaml(updated));
      if (!reparsed.success) throw new WriteError(formatZodError(reparsed.error), 400);

      await writeFile(abs, updated, 'utf8');
      const msg =
        typeof opts.note === 'string' && opts.note.trim()
          ? `log engine service ${id}: ${opts.note.trim()}`
          : `log engine service ${id}`;
      await this.git.commitPaths(['boat.yaml'], msg, author);
      await this.reload();
      await this.syncAfterWrite();
    });
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/server/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/store.ts test/server/store.test.ts
git commit -m "feat(server): ShipStore.logEngineService re-arms a service via boat.yaml (commits only boat.yaml)"
```

---

### Task 6: `GET /api/engine` read route (+ redaction-golden coverage)

**Files:**
- Modify: `src/server/routes/data.ts`
- Test: `test/server/data.test.ts`, `test/server/redaction-golden.test.ts`

**Interfaces:**
- Consumes: `engineView` (from `../../data/index.js`), the existing `view(req)` redacted-dataset helper, `ctx.now`.
- Produces: `GET /api/engine` (requireAuth; open in demo since demo viewer is owner) → `EngineView` `{ hours: { lifetime, hoursStart }, services: EngineServiceStatus[] }`.

- [ ] **Step 1: Write the failing tests.**

Append to `test/server/data.test.ts` (reuse the file's existing crew/owner login helpers; match their names):

```ts
  it('serves the engine view (lifetime hours + per-service status) to crew', async () => {
    const crew = await loginCrew(); // match the helper this file already uses
    const res = await crew.get('/api/engine');
    expect(res.status).toBe(200);
    expect(res.body.hours.lifetime).toBeCloseTo(421.1, 5);
    expect(res.body.hours.hoursStart).toBe(412);
    const fuel = res.body.services.find((s: { id: string }) => s.id === 'fuel-filter');
    expect(fuel.status).toBe('overdue');
    expect(fuel.hoursRemaining < 0).toBe(true);
  });

  it('401s a guest on /api/engine', async () => {
    await request(app).get('/api/engine').expect(401);
  });
```

> Use whatever `request`/`app`/login helpers `data.test.ts` already declares (it logs in crew/owner for other tests). If a guest helper is absent, `request(app)` (no login) is the guest.

Add `'/api/engine'` to the `CREW_ENDPOINTS` array in `test/server/redaction-golden.test.ts`:

```ts
const CREW_ENDPOINTS = [
  '/api/boat', '/api/trips', '/api/maintenance', '/api/inventory',
  '/api/vendors', '/api/manuals', '/api/quickref', '/api/derived', '/api/engine',
  '/api/search?q=halyard', '/api/search?q=92.5',
];
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/server/data.test.ts test/server/redaction-golden.test.ts`
Expected: FAIL — `/api/engine` returns the JSON 404 (route not registered) → 404, not 200/401.

- [ ] **Step 3: Implement** — in `src/server/routes/data.ts`:

1. Extend the data import:

```ts
import { search as searchData, deriveInventoryTasks, deriveAttention, engineView } from '../../data/index.js';
```

2. Add the route (e.g. right after the `/api/derived` route):

```ts
  app.get('/api/engine', requireAuth, (req, res) => res.json(engineView(view(req), now())));
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/server/data.test.ts test/server/redaction-golden.test.ts`
Expected: PASS (crew reads engine, guest 401, no monetary key leaks).

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/data.ts test/server/data.test.ts test/server/redaction-golden.test.ts
git commit -m "feat(server): GET /api/engine read route (engine hours + service status)"
```

---

### Task 7: `POST /api/engine/services/:id/log` write route

**Files:**
- Modify: `src/server/routes/writes.ts`
- Test: `test/server/writes.test.ts`

**Interfaces:**
- Consumes: `store.logEngineService` (Task 5), `engineView`, `redactDataset`, `ctx.now`, the existing `authorFor`/`fail`/`noDemo` helpers in this file.
- Produces: `POST /api/engine/services/:id/log` (requireAuth + denyInDemo → crew + owner; guest 401; demo 403) with JSON body `{ atHours?, on?, note? }`; responds with the re-derived `EngineView`. `404` unknown id, `400` bad input.

- [ ] **Step 1: Write the failing test** — append to `test/server/writes.test.ts` (reuse the file's crew/owner login + `app`/`request` setup):

```ts
  it('crew can log an engine service; it re-arms (status flips to ok) and never leaks money', async () => {
    const crew = await loginCrew(); // match this file's helper
    const res = await crew.post('/api/engine/services/fuel-filter/log').send({});
    expect(res.status).toBe(200);
    const fuel = res.body.services.find((s: { id: string }) => s.id === 'fuel-filter');
    // default atHours = lifetime (~421.1); new dueAt = 421.1 + 200 → ~200 hrs left → ok
    expect(fuel.status).toBe('ok');
    expect('costEst' in (res.body as object)).toBe(false);
  });

  it('owner can log with an explicit reading + date', async () => {
    const owner = await loginOwner(); // match this file's helper
    const res = await owner.post('/api/engine/services/oil/log').send({ atHours: 420, on: '2026-06-01', note: 'Rotella T4' });
    expect(res.status).toBe(200);
    const oil = res.body.services.find((s: { id: string }) => s.id === 'oil');
    expect(oil.lastDoneHours).toBe(420);
    expect(oil.lastDoneDate).toBe('2026-06-01');
  });

  it('404s an unknown service and 400s a bad reading', async () => {
    const crew = await loginCrew();
    await crew.post('/api/engine/services/nope/log').send({}).expect(404);
    await crew.post('/api/engine/services/oil/log').send({ atHours: 'lots' }).expect(400);
  });

  it('401s a guest and 403s in demo', async () => {
    await request(app).post('/api/engine/services/oil/log').send({}).expect(401);
    const { app: demoApp } = await buildTestApp({ demo: true }); // match the import used elsewhere
    await request(demoApp).post('/api/engine/services/oil/log').send({}).expect(403);
  });
```

> Match the helper/import names this test file already uses (`buildTestApp`, login helpers, `request`, `app`).

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/server/writes.test.ts`
Expected: FAIL — route returns 404 (not registered) for the happy-path cases.

- [ ] **Step 3: Implement** — in `src/server/routes/writes.ts`:

1. Add imports:

```ts
import { redactDataset } from '../redact.js';
import { COLLECTION_DIR, engineView, type CollectionName } from '../../data/index.js';
```

(merge `engineView` into the existing `../../data/index.js` import line rather than duplicating it).

2. Pull `now` from ctx — change the destructure at the top of `registerWriteRoutes`:

```ts
  const { store, config, now } = ctx;
```

3. Add the route (e.g. right after the maintenance-complete route):

```ts
  // ---- Engine service log: crew + owner (narrow op — re-arms a service; never touches cost) ----
  app.post('/api/engine/services/:id/log', requireAuth, noDemo, async (req, res) => {
    const { atHours, on, note } = req.body ?? {};
    try {
      await store.logEngineService(req.params.id as string, { atHours, on, note }, authorFor(req));
      res.json(engineView(redactDataset(store.current(), req.viewer.role), now()));
    } catch (err) { fail(res, err); }
  });
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/server/writes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/writes.ts test/server/writes.test.ts
git commit -m "feat(server): POST /api/engine/services/:id/log (crew+owner) re-arms a service"
```

---

### Task 8: UI api client + types

**Files:**
- Modify: `src/ui/lib/types.ts`, `src/ui/lib/api.ts`
- Test: `src/ui/lib/api.test.ts`

**Interfaces:**
- Produces (types): re-exports `Engine`, `EngineService`, `EngineServiceStatus`, `EngineView`.
- Produces (api): `api.engine(): Promise<EngineView>`, `api.logEngineService(id, opts): Promise<EngineView>`.

- [ ] **Step 1: Write the failing test** — append to `src/ui/lib/api.test.ts` (match its `mockFetchOnce`/`jsonResponse` helpers):

```ts
  it('reads the engine view and logs a service', async () => {
    const view = { hours: { lifetime: 421.1, hoursStart: 412 }, services: [{ id: 'oil', label: 'Oil', status: 'ok' }] };
    mockFetchOnce(jsonResponse(view));
    const e = await api.engine();
    expect(e.hours.lifetime).toBe(421.1);

    mockFetchOnce(jsonResponse(view));
    const out = await api.logEngineService('oil', { atHours: 420, on: '2026-06-01', note: 'done' });
    expect(out.services[0].id).toBe('oil');
    // The second call POSTs to the service-log path.
    const url = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[1][0];
    expect(url).toBe('/api/engine/services/oil/log');
  });
```

> Match the file's existing fetch-mock accessor style for asserting the called URL (some tests read `vi.mocked(fetch).mock.calls`). Adapt the last two lines to that file's idiom.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/ui/lib/api.test.ts`
Expected: FAIL — `api.engine` is not a function.

- [ ] **Step 3: Implement.**

In `src/ui/lib/types.ts`:

```ts
// add to the `import type { ... } from '../../data/schema.js'` list:
  Engine,
  EngineService,
// add to the `import type { ... } from '../../data/derive.js'` list:
  EngineServiceStatus,
  EngineView,
// add the same four names to the matching `export type { ... }` block.
```

In `src/ui/lib/api.ts`:

```ts
// add EngineView to the type import from './types.js'
import type { ..., EngineView } from './types.js';

// in the reads section (after `derived`):
  engine: () => get<EngineView>('/api/engine'),

// in the writes section (after `completeMaintenance`):
  logEngineService: (id: string, opts: { atHours?: number; on?: string; note?: string } = {}) =>
    postJson<EngineView>(`/api/engine/services/${eid(id)}/log`, opts),
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/ui/lib/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/lib/types.ts src/ui/lib/api.ts src/ui/lib/api.test.ts
git commit -m "feat(ui): engine api client + types (engine view, log service)"
```

---

### Task 9: Engine card on the Maintenance page

**Files:**
- Modify: `src/ui/pages/MaintenancePage.tsx`
- Modify: `src/ui/pages/MaintenancePage.module.css` (one new class)
- Test: `src/ui/pages/MaintenancePage.test.tsx`

**Interfaces:**
- Consumes: `api.engine`, `api.logEngineService`, `EngineView`/`EngineServiceStatus`, `useSession` (`isOwner`/`isCrew`/`demo`), the existing `Badge`/`NumberField`/`DateField`/`TextAreaField`/`fmtDateShort`/`Icon`.
- Produces: an `EngineCard` rendered on the list view; a per-service "Log service" inline panel (crew + owner, hidden in demo).

- [ ] **Step 1: Write the failing test** — in `src/ui/pages/MaintenancePage.test.tsx`:

1. Add to the `api` mock object: `engine: vi.fn(),` and `logEngineService: vi.fn(),`. Add `const mockedEngine = vi.mocked(api.engine);` and `const mockedLogEngine = vi.mocked(api.logEngineService);`.

2. Add a fixture + default near the other fixtures:

```ts
const ENGINE_VIEW = {
  hours: { lifetime: 421.1, hoursStart: 412 },
  services: [
    { id: 'fuel-filter', label: 'Primary fuel filter', everyHours: 200, lastDoneHours: 205, status: 'overdue', hoursRemaining: -16.1 },
    { id: 'oil', label: 'Engine oil & filter', everyHours: 100, everyMonths: 12, lastDoneHours: 380, status: 'ok', hoursRemaining: 58.9 },
  ],
} as const;
```

3. In the existing `beforeEach` (where `maintenance`/`derived`/`vendors`/`trips` defaults are set), add: `mockedEngine.mockResolvedValue(structuredClone(ENGINE_VIEW)); mockedLogEngine.mockResolvedValue(structuredClone(ENGINE_VIEW));`

4. Add the tests:

```ts
  it('shows the engine card with lifetime hours and a service status', async () => {
    mockedUseSession.mockReturnValue(CREW);
    renderPage(); // match this file's render helper (it wraps MemoryRouter/Routes)
    expect(await screen.findByTestId('engine-card')).toBeInTheDocument();
    expect(screen.getByTestId('engine-lifetime')).toHaveTextContent('421.1');
    expect(within(screen.getByTestId('engine-service-fuel-filter')).getByText('Overdue')).toBeInTheDocument();
  });

  it('lets crew + owner log a service, then refreshes', async () => {
    mockedUseSession.mockReturnValue(OWNER);
    renderPage();
    const row = await screen.findByTestId('engine-service-fuel-filter');
    await userEvent.click(within(row).getByRole('button', { name: /log service/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(mockedLogEngine).toHaveBeenCalledWith('fuel-filter', expect.any(Object)));
    await waitFor(() => expect(mockedMaint).toHaveBeenCalledTimes(2)); // reload after write
  });

  it('hides the log-service control in demo', async () => {
    mockedUseSession.mockReturnValue(DEMO);
    renderPage();
    await screen.findByTestId('engine-card');
    expect(within(screen.getByTestId('engine-service-fuel-filter')).queryByRole('button', { name: /log service/i })).toBeNull();
  });
```

> Match this file's render helper name and `userEvent` import. `mockedMaint` already exists in the file (the maintenance mock); the reload bumps `reloadKey`, which re-runs the load effect and re-calls `api.maintenance`.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/ui/pages/MaintenancePage.test.tsx`
Expected: FAIL — no `engine-card` testid.

- [ ] **Step 3: Implement.**

In `src/ui/pages/MaintenancePage.module.css`, append:

```css
.engineRow {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
```

In `src/ui/pages/MaintenancePage.tsx`:

1. Extend the types import:

```ts
import type { MaintenanceRec, VendorRec, TripRec, Derived, MaintStatus, InventoryTask, EngineView, EngineServiceStatus } from '../lib/types.js';
```

2. Add the two components ABOVE `export default function MaintenancePage` (after the `BoardColumn` component):

```tsx
/* ============================================================== engine card */

function EngineServiceRow({ s, canLog, onLogged }: { s: EngineServiceStatus; canLog: boolean; onLogged: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [atHours, setAtHours] = useState('');
  const [on, setOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tone: BadgeTone = s.status === 'overdue' ? 'overdue' : s.status === 'due' ? 'due' : 'scheduled';
  const label = s.status === 'overdue' ? 'Overdue' : s.status === 'due' ? 'Due soon' : 'OK';

  const bits: string[] = [];
  if (s.hoursRemaining !== undefined) {
    bits.push(s.hoursRemaining < 0 ? `${Math.abs(s.hoursRemaining).toFixed(1)} hrs overdue` : `${s.hoursRemaining.toFixed(1)} hrs left`);
  }
  if (s.dueDate !== undefined) {
    bits.push(s.daysRemaining !== undefined && s.daysRemaining < 0 ? `overdue since ${fmtDateShort(s.dueDate)}` : `due ${fmtDateShort(s.dueDate)}`);
  }
  const interval: string[] = [];
  if (s.everyHours !== undefined) interval.push(`every ${s.everyHours} hrs`);
  if (s.everyMonths !== undefined) interval.push(`every ${s.everyMonths} mo`);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const opts: { atHours?: number; on?: string; note?: string } = {};
      if (atHours.trim()) { const n = Number(atHours); if (Number.isFinite(n)) opts.atHours = n; }
      if (on) opts.on = on;
      if (note.trim()) opts.note = note.trim();
      await api.logEngineService(s.id, opts);
      onLogged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not log this service.');
      setBusy(false);
    }
  };

  return (
    <div className={styles.engineRow} data-testid={`engine-service-${s.id}`}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-8 wrap">
          <span style={{ fontWeight: 600, color: 'var(--ink-800)' }}>{s.label}</span>
          {interval.length > 0 && <span className="muted tiny">{interval.join(' · ')}</span>}
        </div>
        {bits.length > 0 && <div className="muted tiny" style={{ marginTop: 4 }}>{bits.join(' · ')}</div>}
        {open && (
          <div className="card card-pad" data-testid={`engine-log-${s.id}`} style={{ marginTop: 10 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Log service</div>
            {error && <div className="muted tiny" role="alert" style={{ color: 'var(--sig-overdue)', marginBottom: 8 }}>{error}</div>}
            <NumberField label="Engine hours now" value={atHours} onChange={setAtHours} step="0.1" min={0} hint="Leave blank to use the current lifetime hours." />
            <DateField label="Serviced on" value={on} onChange={setOn} />
            <TextAreaField label="Note" value={note} onChange={setNote} rows={2} placeholder="What was done (optional)" />
            <div className="flex gap-8" style={{ marginTop: 6 }}>
              <button type="button" className="btn btn-brass" disabled={busy} onClick={() => void submit()}>
                <Icon name="check" s={16} />{busy ? 'Saving…' : 'Confirm'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-8" style={{ flex: '0 0 auto' }}>
        <Badge tone={tone}>{label}</Badge>
        {canLog && !open && (
          <button type="button" className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 12.5 }} onClick={() => setOpen(true)}>
            <Icon name="check" s={14} />Log service
          </button>
        )}
      </div>
    </div>
  );
}

function EngineCard({ engine, canLog, onLogged }: { engine: EngineView; canLog: boolean; onLogged: () => void }): JSX.Element {
  const since = engine.hours.lifetime - engine.hours.hoursStart;
  return (
    <div className="card card-pad" data-testid="engine-card" style={{ marginBottom: 22 }}>
      <div className="flex items-center wrap" style={{ justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div className="eyebrow">Engine</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--ink-900)' }}>Hours &amp; service</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 26, fontWeight: 600, color: 'var(--brass-deep)' }} data-testid="engine-lifetime">{engine.hours.lifetime.toFixed(1)}</div>
          <div className="muted tiny">{engine.hours.hoursStart.toFixed(1)} baseline + {since.toFixed(1)} logged</div>
        </div>
      </div>
      {engine.services.length > 0 && (
        <div className="stack" style={{ gap: 0 }}>
          {engine.services.map((s, i) => (
            <div key={s.id} style={{ borderTop: i ? '1px solid var(--line)' : 'none', padding: '10px 0' }}>
              <EngineServiceRow s={s} canLog={canLog} onLogged={onLogged} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

3. In the `MaintenancePage` component body, add engine state + fetch:

```ts
  const [engine, setEngine] = useState<EngineView | null>(null);
```

Add `api.engine().catch(() => null)` to the `Promise.all([...])` array and capture it — change the array and the `.then` destructure:

```ts
    Promise.all([
      api.maintenance(),
      api.derived(),
      api.vendors().catch(() => [] as VendorRec[]),
      api.trips().catch(() => [] as TripRec[]),
      api.engine().catch(() => null),
    ])
      .then(([m, d, v, t, e]) => {
        if (!alive) return;
        setItems(m);
        setDerived(d);
        setVendors(v);
        setTrips(t);
        setEngine(e);
      })
```

4. Render the card in the main list `return`, immediately AFTER the `<div className="page-head">…</div>` block and BEFORE the rollup `<div className="grid g-4" …>`:

```tsx
        {engine && (engine.services.length > 0 || engine.hours.lifetime > 0) && (
          <EngineCard engine={engine} canLog={canComplete} onLogged={reload} />
        )}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/ui/pages/MaintenancePage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/pages/MaintenancePage.tsx src/ui/pages/MaintenancePage.module.css src/ui/pages/MaintenancePage.test.tsx
git commit -m "feat(ui): engine hours + service card on the maintenance page (crew+owner log service)"
```

---

### Task 10: Docs — SCHEMA.md (mirrored), CLAUDE.md, README.md

**Files:**
- Modify: `data-template/SCHEMA.md` → then `cp` to `demo/SCHEMA.md`
- Modify: `CLAUDE.md`, `README.md`
- Test: `test/data/schema-doc.test.ts`, `test/data/p3-doc-drift-golden.test.ts`, `test/data/cowork-docs-mirror.test.ts` (must stay green)

**Interfaces:** docs only; no code interfaces.

- [ ] **Step 1: Edit `data-template/SCHEMA.md`.**

(a) In the `### trip` table, change the `engineHrs` note to make the lifetime link explicit:

```
| `engineHrs`   | number                   | no  | engine hours run this trip (summed into lifetime engine hours) |
```

(b) In the `### boat.yaml` table, add an `engine` row after the `specs` row:

```
| `engine`      | object                            | no  | engine-hours baseline + recurring service schedule (see below) |
```

(c) Immediately after the `welcome` holds: … **No money ever lives in boat.yaml.** paragraph, add a new subsection:

```markdown
#### `engine` — hours + service schedule

Optional. Drives the lifetime "hours on the motor" figure and the engine-service
reminders. No money ever lives here.

| Field        | Type             | Req | Notes |
| ------------ | ---------------- | --- | ----- |
| `hoursStart` | number           | no  | baseline meter reading when the log began (treated as 0 when absent) |
| `services`   | engineService[]  | no  | recurring services (oil, impeller, fuel filter, …) |

Each `engineService`:

| Field           | Type    | Req | Notes |
| --------------- | ------- | --- | ----- |
| `id`            | string  | yes | unique slug within `services` (e.g. `oil`) |
| `label`         | string  | yes | human label, e.g. `Engine oil & filter` |
| `everyHours`    | number  | no  | hour interval (positive) |
| `everyMonths`   | number  | no  | calendar interval in months (positive) |
| `lastDoneHours` | number  | no  | engine hours at the last service |
| `lastDoneDate`  | isoDate | no  | date of the last service |

**Lifetime hours** = `hoursStart` + Σ each trip's `engineHrs`. A service comes
**due/overdue** when it passes its **hour** interval *or* its **calendar**
interval, whichever first (the worse of the two): by hours when
`(lastDoneHours ?? hoursStart) + everyHours ≤ lifetime`, and by date when
`lastDoneDate + everyMonths` has arrived. A calendar interval with no
`lastDoneDate` to anchor from is inactive until the service is first logged.
These are computed at read time — never stored.
```

- [ ] **Step 2: Mirror to demo.**

```bash
cp data-template/SCHEMA.md demo/SCHEMA.md
```

- [ ] **Step 3: Update `CLAUDE.md`.** Add a new section after the "## Conditions (weather + tides)" section:

```markdown
## Motor hours (engine hours + service schedule)

- **Per-trip `engineHrs`** (existing, on `tripSchema`) is "engine hours run this
  outing." **Lifetime engine hours** = `boat.engine.hoursStart` (a baseline) + Σ
  `engineHrs`, derived by `deriveEngineHours` in `src/data/derive.ts`.
- **`boat.yaml` `engine` block** (`engineSchema` in `src/data/schema.ts`):
  `hoursStart` + `services[]` (each `{ id, label, everyHours?, everyMonths?,
  lastDoneHours?, lastDoneDate? }`). It is **non-monetary** — never add a cost
  field to it; `monetary.ts`/`redact.ts` are untouched and `redaction-golden`
  covers `GET /api/engine`.
- **Service reminders** are derived (`deriveEngineServiceStatuses` /
  `deriveEngineServiceTasks`, injected `now`): a service is due/overdue by **hours
  OR calendar, whichever first** (worse-of-two). Hour-due window is
  `ENGINE_DUE_WINDOW_HOURS` (10); calendar reuses `DUE_WINDOW_DAYS` (30). Engine
  tasks are folded into `deriveAttention` (the maintenance nav badge).
- **`GET /api/engine`** (requireAuth; open in demo) serves
  `{ hours: { lifetime, hoursStart }, services: EngineServiceStatus[] }` via
  `engineView`. **`POST /api/engine/services/:id/log`** (crew + owner, `denyInDemo`)
  re-arms a service: `ShipStore.logEngineService` edits `boat.yaml`
  comment-preservingly (`applyEngineServiceLog`, the `yaml` Document API),
  defaulting `atHours` to the current lifetime and `on` to today, and commits
  **only** `boat.yaml`.
- **UI:** an Engine card on the Maintenance page (`MaintenancePage.tsx`) shows
  lifetime hours + per-service status with a crew+owner "Log service" panel
  (hidden in demo). The schedule itself is curated in `boat.yaml` via the data
  repo (no in-app schedule editor).
- **Same-change rule:** when you add/rename an `engine` field, update
  `schema.ts`, `derive.ts`, `SCHEMA.md` (`data-template/` canonical → `cp` to
  `demo/`), and this section together.
```

- [ ] **Step 4: Update `README.md`.** If README has an API-endpoint list or a data-model/feature section, add a one-line entry for the engine feature, e.g. under the reads/writes list:

```markdown
- `GET /api/engine` — lifetime engine hours + per-service due/overdue status (all authed roles).
- `POST /api/engine/services/:id/log` — crew + owner; re-arms a recurring engine service.
```

and, if README documents `boat.yaml`, mention the optional `engine` block (baseline + service schedule). If README has no such section, add a short "Motor hours" bullet to its feature overview. (Read README first and place it where the existing structure fits — do not invent a new top-level section if a natural home exists.)

- [ ] **Step 5: Run the doc guards + commit**

Run: `npm test -- test/data/schema-doc.test.ts test/data/p3-doc-drift-golden.test.ts test/data/cowork-docs-mirror.test.ts`
Expected: PASS (byte-identical SCHEMA.md copies; no descriptor drift).

```bash
git add data-template/SCHEMA.md demo/SCHEMA.md CLAUDE.md README.md
git commit -m "docs(motor-hours): document the engine block, lifetime hours, and service reminders"
```

---

### Task 11: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck both projects**

Run: `npm run typecheck`
Expected: no errors (server `tsconfig.json` + UI `tsconfig.ui.json`).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all `server` + `ui` tests green. Pay attention to `redaction-golden`, `data` (attention now 5), `derive`, `store`, `writes`, `MaintenancePage`, and the doc-drift/mirror suites.

- [ ] **Step 3: Confirm the demo renders the feature (optional manual check)**

Run: `npm run dev` (server, demo mode) + `npm run dev:ui` in another terminal, open the Maintenance page, and confirm the Engine card shows ~421.1 lifetime hours with the fuel-filter overdue. (Demo is read-only, so "Log service" is hidden — that's correct.)

- [ ] **Step 4: Final commit (if any stray fixes were needed)**

```bash
git add -A
git commit -m "chore(motor-hours): final verification fixes"
```

---

## Self-Review

**1. Spec coverage** (each spec section → task):
- Data model (`engineHrs` + `engine` block) → Task 1 (schema), Task 3 (demo/template data).
- Derivation & triggers (lifetime, hours-or-calendar worse-of-two, `addMonths` clamp, attention) → Task 2.
- API (`GET /api/engine`, `POST …/log`, `ShipStore.logEngineService`) → Tasks 5, 6, 7.
- UI (Engine card on Maintenance page, crew+owner Log service, graceful degrade) → Task 9.
- Data & docs (demo block, template placeholder, SCHEMA.md mirror) → Tasks 3, 10.
- Testing (schema, derive, write helper, store, server read/write, UI, golden/doc guards) → every task + Task 11.
- Security (non-monetary, redaction-golden covers `/api/engine`, monetary.ts untouched) → Task 6 + Global Constraints.
- Out of scope (no generic meters, no in-app schedule editor, no cost routing, no per-service history) → respected; not built.

**2. Placeholder scan:** every code step contains the actual code/commands. The only "match the file's existing helper name" notes are in TEST files where the harness helpers (login agents, render wrappers, fetch mocks) already exist and vary by file — the executor must bind to the real local names rather than a guessed one; the assertions themselves are concrete.

**3. Type consistency:** `EngineServiceStatus` / `EngineServiceTask` / `EngineView` / `deriveEngineHours` / `deriveEngineServiceStatuses` / `deriveEngineServiceTasks` / `engineView` / `applyEngineServiceLog` / `logEngineService` are spelled identically across schema → derive → store → routes → ui. `engineView` is defined in `derive.ts` (Task 2) and consumed in both routes (Tasks 6, 7). `applyEngineServiceLog` is defined in `write.ts` (Task 4) and consumed by the store (Task 5). `deriveAttention` is updated once (Task 2) and both `/api/derived` (existing) and the demo count (Task 3) rely on that single change.

**4. Known cross-task interaction (verified):** Task 3 adds a demo engine block whose hours-overdue `fuel-filter` raises `/api/derived` attention from 4 → 5 at `FIXED_NOW`; the `data.test.ts` assertion is updated in the same task. The `deriveAttention` test (Task 2) is rewritten to compute its expected value via the functions, so it stays correct before and after Task 3.
