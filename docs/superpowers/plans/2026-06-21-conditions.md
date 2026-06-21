# Conditions (weather + tides) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an all-access **Conditions** page showing marine weather (~48h) and tides (nearest station + a curated set of spanning stations) for the boat's last/known location, fed either by a Cowork/Hermes-maintained file (agent mode) or a live server-side fetch (api mode).

**Architecture:** One singleton record file in the data repo — `conditions.md` (frontmatter + optional Markdown body) — loaded into the `Dataset` and served by one **public** `GET /api/conditions`. A `source: agent | api` flag selects whether the weather periods + tide predictions come from the file (served verbatim) or from a live, TTL-cached server fetch (Open-Meteo for weather, NOAA CO-OPS for tides). The SPA `ConditionsPage` is a pure API client over that one endpoint.

**Tech Stack:** TypeScript (ESM, Node 20+), Express, Zod, Vitest (server + ui projects), React 18 + Vite. Free keyless APIs: Open-Meteo (Forecast + Marine) and NOAA CO-OPS Tides & Currents.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-21-conditions-design.md`. Read it before starting.
- **TDD always:** write the failing test, run it red, implement minimal code, run it green, commit. One logical change per commit.
- **Data layer determinism:** never call argless `new Date()` in `src/data/`. Server fetch/cache logic takes an injected `now: () => Date` and an injected `fetch`. The SPA may call `new Date()` for display.
- **Cost-redaction invariant is untouched:** Conditions carries NO monetary fields and is NOT a collection (no id prefix, cross-links, or monetary registry entry). The `redaction-golden` test must stay green — never weaken it.
- **CSP stays `connect-src 'self'`:** all external fetching is server-side. Do not add browser-side external calls or widen CSP.
- **Doc-upkeep rule (required):** `README.md` and `CLAUDE.md` must be updated in this change (Task 13). The Cowork docs `AGENTS.md`/`SCHEMA.md` are authored canonically under `data-template/` and **byte-copied** into `demo/` — the `cowork-docs-mirror` / `p3-doc-drift-golden` tests enforce this.
- **Module discipline:** `src/data/` modules have one responsibility each; the server imports the data layer only from `src/data/index.ts`. New server fetch code lives under `src/server/conditions/`.
- **Test commands:** `npm test` runs both Vitest projects. To run one file: `npx vitest run <path>`. Typecheck both projects: `npm run typecheck`.
- **Branch:** work on `feat/conditions` (already created). The spec commit is already on it.

---

### Task 1: Conditions schema (data layer)

**Files:**
- Modify: `src/data/schema.ts` (append after the existing schemas, before `collectionSchemas`)
- Test: `test/data/conditions-schema.test.ts` (create)

**Interfaces:**
- Produces: `conditionsSchema` (Zod), and types `Conditions`, `ConditionLocation`, `WeatherPeriod`, `Weather`, `TideStation`, `TidePrediction`, `Tides`. `Conditions` shape: `{ source: 'agent'|'api'; location: ConditionLocation; weather?: Weather; tides?: Tides }`. These are re-exported automatically via `src/data/index.ts` (`export * from './schema.js'`).

- [ ] **Step 1: Write the failing test**

Create `test/data/conditions-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { conditionsSchema } from '../../src/data/schema.js';

describe('conditionsSchema', () => {
  it('accepts a full agent-mode record (location + readings)', () => {
    const r = conditionsSchema.parse({
      source: 'agent',
      location: { label: 'Charleston Harbor', lat: 32.78, lon: -79.93, asOf: '2026-06-20T13:00:00Z' },
      weather: {
        asOf: '2026-06-20T13:05:00Z',
        source: 'NWS AMZ330',
        summary: 'SW 10-15 kt',
        periods: [{ time: '2026-06-20T14:00:00Z', windDir: 'SW', windKt: 12, gustKt: 18, tempF: 84, seasFt: 2.5, sky: 'Partly cloudy', precipPct: 10 }],
      },
      tides: {
        stations: [{ id: '8665530', name: 'Charleston', area: 'Charleston Harbor', primary: true }],
        predictions: { '8665530': [{ type: 'H', time: '2026-06-20T15:12:00Z', heightFt: 5.8 }] },
      },
    });
    expect(r.source).toBe('agent');
    expect(r.tides?.predictions?.['8665530'][0].type).toBe('H');
  });

  it('accepts an api-mode config-only record (no readings)', () => {
    const r = conditionsSchema.parse({
      source: 'api',
      location: { label: 'Charleston', lat: 32.78, lon: -79.93 },
      tides: { stations: [{ id: '8665530', name: 'Charleston', primary: true }] },
    });
    expect(r.source).toBe('api');
    expect(r.weather).toBeUndefined();
    expect(r.tides?.predictions).toBeUndefined();
  });

  it('requires source and location', () => {
    expect(conditionsSchema.safeParse({ source: 'api' }).success).toBe(false);
    expect(conditionsSchema.safeParse({ location: { label: 'x', lat: 1, lon: 2 } }).success).toBe(false);
  });

  it('rejects an unknown source and a non-H/L tide type', () => {
    expect(conditionsSchema.safeParse({ source: 'manual', location: { label: 'x', lat: 1, lon: 2 } }).success).toBe(false);
    expect(conditionsSchema.safeParse({
      source: 'agent',
      location: { label: 'x', lat: 1, lon: 2 },
      tides: { predictions: { s: [{ type: 'X', time: 't' }] } },
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/data/conditions-schema.test.ts`
Expected: FAIL — `conditionsSchema` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/data/schema.ts`, append after `quickrefSchema`/`Quickref` (and before the `boatSchema` block is fine; placement among the schema definitions doesn't matter, but keep it before `collectionSchemas`):

```ts
// ---- Conditions (weather + tides) — a singleton config like boat/quickref ----
// NOT a record collection: no id prefix, no cross-links, no monetary fields.
// `weather` and `tides.predictions` are optional so an api-mode (config-only)
// file validates without them; the server fills them in live.

export const conditionLocationSchema = z.object({
  label: z.string(),
  lat: z.number(),
  lon: z.number(),
  asOf: z.string().optional(),
});
export type ConditionLocation = z.infer<typeof conditionLocationSchema>;

export const weatherPeriodSchema = z.object({
  time: z.string(),
  windDir: z.string().optional(),
  windKt: z.number().optional(),
  gustKt: z.number().optional(),
  tempF: z.number().optional(),
  seasFt: z.number().optional(),
  sky: z.string().optional(),
  precipPct: z.number().optional(),
});
export type WeatherPeriod = z.infer<typeof weatherPeriodSchema>;

export const weatherSchema = z.object({
  asOf: z.string().optional(),
  source: z.string().optional(),
  summary: z.string().optional(),
  periods: z.array(weatherPeriodSchema).optional(),
});
export type Weather = z.infer<typeof weatherSchema>;

export const tideStationSchema = z.object({
  id: z.string(),
  name: z.string(),
  area: z.string().optional(),
  primary: z.boolean().optional(),
});
export type TideStation = z.infer<typeof tideStationSchema>;

export const tidePredictionSchema = z.object({
  type: z.enum(['H', 'L']),
  time: z.string(),
  heightFt: z.number().optional(),
});
export type TidePrediction = z.infer<typeof tidePredictionSchema>;

export const tidesSchema = z.object({
  stations: z.array(tideStationSchema).optional(),
  predictions: z.record(z.string(), z.array(tidePredictionSchema)).optional(),
});
export type Tides = z.infer<typeof tidesSchema>;

export const conditionsSchema = z.object({
  source: z.enum(['agent', 'api']),
  location: conditionLocationSchema,
  weather: weatherSchema.optional(),
  tides: tidesSchema.optional(),
});
export type Conditions = z.infer<typeof conditionsSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/data/conditions-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/schema.ts test/data/conditions-schema.test.ts
git commit -m "feat(data): conditions schema (weather + tides singleton)"
```

---

### Task 2: Demo `conditions.md` fixture (agent mode)

**Files:**
- Create: `demo/conditions.md`

**Interfaces:**
- Produces: a schema-valid agent-mode `conditions.md` in the demo dataset. Consumed by Task 3 (loader test), Task 10 (route agent-mode test), and Task 11 (redaction golden). Values referenced by later tests: `location.label === 'Charleston Harbor entrance'`, a station named `Wando River` with `area: 'Wando R.'`, and the primary station id `8665530`.

This task has no separate unit test of its own; it is a fixture other tasks assert against. Verify it loads at the end of Task 3.

- [ ] **Step 1: Create the fixture**

Create `demo/conditions.md`:

```markdown
---
source: agent
location:
  label: "Charleston Harbor entrance"
  lat: 32.7765
  lon: -79.9311
  asOf: 2026-06-20T13:00:00Z
weather:
  asOf: 2026-06-20T13:05:00Z
  source: "NWS marine zone AMZ330 (sample)"
  summary: "SW 10-15 kt, seas 2-3 ft, building Thursday."
  periods:
    - { time: 2026-06-20T14:00:00Z, windDir: SW, windKt: 12, gustKt: 18, tempF: 84, seasFt: 2.5, sky: "Partly cloudy", precipPct: 10 }
    - { time: 2026-06-20T17:00:00Z, windDir: SW, windKt: 14, gustKt: 20, tempF: 86, seasFt: 2.5, sky: "Partly cloudy", precipPct: 10 }
    - { time: 2026-06-20T20:00:00Z, windDir: SSW, windKt: 10, gustKt: 15, tempF: 81, seasFt: 2.0, sky: "Clear", precipPct: 5 }
    - { time: 2026-06-20T23:00:00Z, windDir: S, windKt: 7, gustKt: 11, tempF: 78, seasFt: 1.5, sky: "Clear", precipPct: 5 }
    - { time: 2026-06-21T02:00:00Z, windDir: S, windKt: 6, gustKt: 10, tempF: 76, seasFt: 1.5, sky: "Clear", precipPct: 0 }
    - { time: 2026-06-21T14:00:00Z, windDir: NW, windKt: 15, gustKt: 22, tempF: 83, seasFt: 3.0, sky: "Showers", precipPct: 40 }
tides:
  stations:
    - { id: "8665530", name: "Charleston, Customs House Wharf", area: "Charleston Harbor", primary: true }
    - { id: "8665543", name: "Wando River, Causeway", area: "Wando R." }
    - { id: "8664753", name: "Cooper River, Filbin Creek", area: "Cooper R." }
    - { id: "8665245", name: "Ashley River, Wappoo Creek", area: "Ashley R." }
    - { id: "8665002", name: "ICW, Church Creek", area: "ICW South" }
    - { id: "8664984", name: "ICW, Isle of Palms", area: "ICW North" }
  predictions:
    "8665530":
      - { type: H, time: 2026-06-20T15:12:00Z, heightFt: 5.8 }
      - { type: L, time: 2026-06-20T21:30:00Z, heightFt: 0.4 }
      - { type: H, time: 2026-06-21T03:36:00Z, heightFt: 5.6 }
      - { type: L, time: 2026-06-21T09:48:00Z, heightFt: 0.6 }
    "8665543":
      - { type: H, time: 2026-06-20T15:48:00Z, heightFt: 5.6 }
      - { type: L, time: 2026-06-20T22:06:00Z, heightFt: 0.5 }
    "8664753":
      - { type: H, time: 2026-06-20T16:05:00Z, heightFt: 5.5 }
      - { type: L, time: 2026-06-20T22:24:00Z, heightFt: 0.6 }
---

Light SW sea breeze fills in by early afternoon. A weak front Thursday backs the
wind NW and kicks up a short harbor chop — take your window before noon.
```

- [ ] **Step 2: Commit**

```bash
git add demo/conditions.md
git commit -m "feat(demo): sample agent-mode conditions.md (Charleston)"
```

---

### Task 3: Dataset loader picks up `conditions.md`

**Files:**
- Modify: `src/data/dataset.ts`
- Test: `test/data/dataset.test.ts` (append cases)

**Interfaces:**
- Consumes: `conditionsSchema`, `Conditions` (Task 1); `parseRecord` (already imported via `./record.js`... actually dataset.ts uses it through `parseRecord` import — see below).
- Produces: `Dataset.conditions?: WithBody<Conditions> | null`. `loadDataset` sets it to the parsed file, or `null` when absent; throws on a present-but-invalid file.

- [ ] **Step 1: Write the failing tests**

Append to `test/data/dataset.test.ts` (inside the existing `describe('loadDataset', …)`):

```ts
  it('loads the conditions.md singleton from the demo dataset', async () => {
    const ds = await loadDataset(DEMO);
    expect(ds.conditions?.source).toBe('agent');
    expect(ds.conditions?.location.label).toBe('Charleston Harbor entrance');
    expect(ds.conditions?.tides?.stations?.some((s) => s.area === 'Wando R.')).toBe(true);
    expect(ds.conditions?.body).toContain('sea breeze');
  });

  it('returns null conditions when conditions.md is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-'));
    writeFileSync(join(dir, 'boat.yaml'), 'name: Test\n');
    const ds = await loadDataset(dir);
    expect(ds.conditions).toBeNull();
  });

  it('throws on a present-but-invalid conditions.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-'));
    writeFileSync(join(dir, 'boat.yaml'), 'name: Test\n');
    writeFileSync(join(dir, 'conditions.md'), '---\nsource: api\n---\nno location\n');
    await expect(loadDataset(dir)).rejects.toThrow(/conditions\.md/);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/data/dataset.test.ts`
Expected: FAIL — `ds.conditions` is undefined / no loader.

- [ ] **Step 3: Implement the loader**

In `src/data/dataset.ts`:

1. Add to the schema import (the block importing from `./schema.js`) the names `conditionsSchema` and `type Conditions`:

```ts
import {
  boatSchema, tripSchema, maintenanceSchema, costSchema, vendorSchema,
  inventorySchema, manualSchema, quickrefSchema, conditionsSchema,
  type Boat, type Trip, type Maintenance, type Cost, type Vendor,
  type Inventory, type Manual, type Quickref, type Conditions,
} from './schema.js';
```

2. Add the `parseRecord` import at the top (it currently is NOT imported in dataset.ts — `loadCollection` calls it; confirm the existing import line `import { parseRecord } from './record.js';` is present. It is.).

3. Add `conditions` to the `Dataset` interface (optional, to avoid breaking partial-dataset test casts):

```ts
export interface Dataset {
  boat: Boat;
  trips: WithBody<Trip>[];
  maintenance: WithBody<Maintenance>[];
  costs: WithBody<Cost>[];
  vendors: WithBody<Vendor>[];
  inventory: WithBody<Inventory>[];
  manuals: WithBody<Manual>[];
  quickref: Quickref;
  conditions?: WithBody<Conditions> | null;
}
```

4. Add a singleton loader function (after `loadCollection`):

```ts
/** Load the optional `conditions.md` singleton (frontmatter + Markdown body).
 *  Missing file => null (feature not set up). A present-but-invalid file is a
 *  loud error, matching the loader's fail-loud rule. */
async function loadConditions(dir: string): Promise<WithBody<Conditions> | null> {
  let raw: string;
  try {
    raw = await readFile(join(dir, 'conditions.md'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return null;
  }
  const { data, body } = parseRecord(raw);
  const parsed = conditionsSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid conditions.md: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    );
  }
  return { ...parsed.data, body };
}
```

5. Add `conditions` to the `loadDataset` return object:

```ts
    manuals: await loadCollection(dir, 'manuals', manualSchema),
    quickref,
    conditions: await loadConditions(dir),
  };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/data/dataset.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/data/dataset.ts test/data/dataset.test.ts
git commit -m "feat(data): load optional conditions.md singleton into Dataset"
```

---

### Task 4: UI format helpers — `fmtTime`, `fmtRelative`

**Files:**
- Modify: `src/ui/lib/format.ts`
- Test: `src/ui/lib/format.test.ts` (create if absent; otherwise append)

**Interfaces:**
- Produces: `fmtTime(iso): string` (`"3:12 PM"`, local tz; empty/invalid → passthrough/empty) and `fmtRelative(iso, now: Date): string` (`"3h ago"`, `"just now"`, `"in 2h"`; empty/invalid → `''`).

- [ ] **Step 1: Write the failing test**

Create `src/ui/lib/format.test.ts` (or append if it exists):

```ts
import { describe, it, expect } from 'vitest';
import { fmtTime, fmtRelative } from './format.js';

describe('fmtTime', () => {
  it('formats a full ISO timestamp as a clock time', () => {
    const out = fmtTime('2026-06-20T15:12:00Z');
    expect(out).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
  });
  it('returns empty string for empty input', () => {
    expect(fmtTime(undefined)).toBe('');
    expect(fmtTime('')).toBe('');
  });
});

describe('fmtRelative', () => {
  const now = new Date('2026-06-20T18:00:00Z');
  it('reports hours ago', () => {
    expect(fmtRelative('2026-06-20T15:00:00Z', now)).toBe('3h ago');
  });
  it('reports minutes ago', () => {
    expect(fmtRelative('2026-06-20T17:30:00Z', now)).toBe('30m ago');
  });
  it('reports just now within a minute', () => {
    expect(fmtRelative('2026-06-20T18:00:20Z', now)).toBe('just now');
  });
  it('reports future as "in Xh"', () => {
    expect(fmtRelative('2026-06-20T20:00:00Z', now)).toBe('in 2h');
  });
  it('returns empty string for empty/invalid input', () => {
    expect(fmtRelative(undefined, now)).toBe('');
    expect(fmtRelative('not-a-date', now)).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/lib/format.test.ts`
Expected: FAIL — `fmtTime`/`fmtRelative` not exported.

- [ ] **Step 3: Implement**

Append to `src/ui/lib/format.ts`:

```ts
/** `3:12 PM` from a full ISO timestamp (rendered in local time). Empty input
 *  returns ''; an unparseable string passes through unchanged. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** `3h ago` / `30m ago` / `just now` / `in 2h` relative to `now`. Empty or
 *  unparseable input returns ''. Used for the "updated …" line on Conditions. */
export function fmtRelative(iso: string | null | undefined, now: Date): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diffMin = Math.round((now.getTime() - t) / 60_000);
  if (Math.abs(diffMin) < 1) return 'just now';
  const m = Math.abs(diffMin);
  const txt = m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  return diffMin > 0 ? `${txt} ago` : `in ${txt}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/ui/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/lib/format.ts src/ui/lib/format.test.ts
git commit -m "feat(ui): fmtTime + fmtRelative formatters for Conditions"
```

---

### Task 5: UI API type + client method

**Files:**
- Modify: `src/ui/lib/types.ts`
- Modify: `src/ui/lib/api.ts`

**Interfaces:**
- Produces: type `Conditions` (the `/api/conditions` response view) and `api.conditions(): Promise<Conditions>`. The response view:
  `{ configured: boolean; source?: 'agent'|'api'; location?: ConditionsLocation; weather?: ConditionsWeather; tides?: ConditionsTides; body?: string; asOf?: string; stale: boolean; error?: string }`.

This task is type-only plumbing; it is exercised by Task 12's page test (which mocks `api.conditions`). No standalone test. Verify with `npm run typecheck`.

- [ ] **Step 1: Add the response types**

In `src/ui/lib/types.ts`, extend the schema re-export import to include the conditions sub-types, then add the view interfaces.

Change the import block to add the three sub-types:

```ts
import type {
  Trip,
  Maintenance,
  MaintStatus,
  Inventory,
  Vendor,
  Manual,
  Cost,
  Boat,
  WeatherPeriod,
  TideStation,
  TidePrediction,
} from '../../data/schema.js';
```

Add them to the `export type { … }` block (so pages can import them):

```ts
export type {
  Trip,
  Maintenance,
  MaintStatus,
  Inventory,
  Vendor,
  Manual,
  Cost,
  Boat,
  WithBody,
  SearchHit,
  InventoryTask,
  InventoryTaskKind,
  TaskStatus,
  WeatherPeriod,
  TideStation,
  TidePrediction,
};
```

Append the view interfaces (e.g. after the `Welcome` interface):

```ts
/** GET /api/conditions — the all-access weather + tides view. `configured:false`
 *  means no conditions.md exists yet. In api mode the server fills weather.periods
 *  and tides.predictions live; in agent mode they come straight from the file. */
export interface ConditionsLocation {
  label: string;
  lat: number;
  lon: number;
  asOf?: string;
}
export interface ConditionsWeather {
  asOf?: string;
  source?: string;
  summary?: string;
  periods?: WeatherPeriod[];
}
export interface ConditionsTides {
  stations?: TideStation[];
  predictions?: Record<string, TidePrediction[]>;
}
export interface Conditions {
  configured: boolean;
  source?: 'agent' | 'api';
  location?: ConditionsLocation;
  weather?: ConditionsWeather;
  tides?: ConditionsTides;
  body?: string;
  asOf?: string;
  stale: boolean;
  error?: string;
}
```

- [ ] **Step 2: Add the client method**

In `src/ui/lib/api.ts`:

1. Add `Conditions` to the type import block (alongside `Welcome`):

```ts
  Welcome,
  Conditions,
```

2. In the `---- discovery / public ----` section (next to `welcome`), add:

```ts
  conditions: () => get<Conditions>('/api/conditions'),
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/ui/lib/types.ts src/ui/lib/api.ts
git commit -m "feat(ui): Conditions API type + api.conditions() client"
```

---

### Task 6: Config — `CONDITIONS_FETCH` kill-switch

**Files:**
- Modify: `src/server/config.ts`
- Test: `test/server/config.test.ts` (append cases)

**Interfaces:**
- Produces: `Config.conditionsFetch: boolean` (default `true`; `false` only when `CONDITIONS_FETCH` is the string `"false"`, case-insensitive). Consumed by Task 10's route.

- [ ] **Step 1: Write the failing test**

Append to `test/server/config.test.ts` a new `describe` (match the file's existing import of `loadConfig`; it imports from `../../src/server/config.js` and passes a demo dir placeholder — reuse the same call style already used in that file):

```ts
describe('CONDITIONS_FETCH', () => {
  it('defaults conditionsFetch to true when unset', () => {
    const cfg = loadConfig({ DATA_DIR: '/tmp/x', SESSION_SECRET: 's' }, '/demo');
    expect(cfg.conditionsFetch).toBe(true);
  });
  it('disables conditionsFetch only for the string "false"', () => {
    expect(loadConfig({ DATA_DIR: '/tmp/x', SESSION_SECRET: 's', CONDITIONS_FETCH: 'false' }, '/demo').conditionsFetch).toBe(false);
    expect(loadConfig({ DATA_DIR: '/tmp/x', SESSION_SECRET: 's', CONDITIONS_FETCH: 'true' }, '/demo').conditionsFetch).toBe(true);
    expect(loadConfig({ DATA_DIR: '/tmp/x', SESSION_SECRET: 's', CONDITIONS_FETCH: 'FALSE' }, '/demo').conditionsFetch).toBe(false);
  });
});
```

> If the existing test file's `loadConfig` calls use a different demo-dir argument or env-builder helper, follow that file's established pattern for the call signature — the assertions on `cfg.conditionsFetch` are what matter.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/server/config.test.ts`
Expected: FAIL — `conditionsFetch` does not exist on `Config`.

- [ ] **Step 3: Implement**

In `src/server/config.ts`:

1. Add to the `Config` interface (e.g. after `pullIntervalMs`):

```ts
  conditionsFetch: boolean; // CONDITIONS_FETCH=false forbids server-side weather/tide fetches (api mode degrades to "unavailable")
```

2. Add to `envSchema`:

```ts
  CONDITIONS_FETCH: z.string().optional(),
```

3. Add to the returned config object (near `pullIntervalMs`):

```ts
    conditionsFetch: e.CONDITIONS_FETCH?.toLowerCase() !== 'false',
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/server/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts test/server/config.test.ts
git commit -m "feat(config): CONDITIONS_FETCH kill-switch for live conditions fetch"
```

---

### Task 7: Weather client (Open-Meteo)

**Files:**
- Create: `src/server/conditions/weather.ts`
- Test: `test/server/conditions-weather.test.ts` (create)

**Interfaces:**
- Produces: `fetchWeather(fetchImpl: typeof globalThis.fetch, location: { lat: number; lon: number }): Promise<WeatherPeriod[]>`. Hits Open-Meteo Forecast + Marine, normalizes hourly data to ~16 periods (every 3rd hour over ~48h), converts wind degrees → 8-point compass, maps WMO `weather_code` → short sky text, and ISO-normalizes times to `…:00Z`. Throws if the forecast fetch is not ok or returns no hourly data; a failed marine fetch just omits `seasFt`.

- [ ] **Step 1: Write the failing test**

Create `test/server/conditions-weather.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchWeather } from '../../src/server/conditions/weather.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const FORECAST = {
  hourly: {
    time: ['2026-06-20T14:00', '2026-06-20T15:00', '2026-06-20T16:00', '2026-06-20T17:00'],
    temperature_2m: [84, 85, 86, 86],
    wind_speed_10m: [12, 13, 14, 14],
    wind_gusts_10m: [18, 19, 20, 20],
    wind_direction_10m: [225, 225, 200, 180],
    precipitation_probability: [10, 10, 20, 30],
    weather_code: [2, 2, 80, 3],
  },
};
const MARINE = {
  hourly: { time: ['2026-06-20T14:00', '2026-06-20T15:00', '2026-06-20T16:00', '2026-06-20T17:00'], wave_height: [2.5, 2.6, 2.7, 2.8] },
};

describe('fetchWeather', () => {
  it('merges forecast + marine into normalized periods every 3 hours', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      jsonResponse(String(url).includes('marine-api') ? MARINE : FORECAST),
    ) as unknown as typeof globalThis.fetch;
    const periods = await fetchWeather(fetchImpl, { lat: 32.78, lon: -79.93 });
    // 4 hourly points, step 3 => indices 0 and 3 => 2 periods.
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ time: '2026-06-20T14:00:00Z', windDir: 'SW', windKt: 12, gustKt: 18, tempF: 84, seasFt: 2.5, sky: 'Partly cloudy', precipPct: 10 });
    expect(periods[1].time).toBe('2026-06-20T17:00:00Z');
    expect(periods[1].windDir).toBe('S'); // 180deg
  });

  it('omits seasFt when the marine fetch fails but keeps forecast data', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('marine-api') ? jsonResponse({}, false, 500) : jsonResponse(FORECAST),
    ) as unknown as typeof globalThis.fetch;
    const periods = await fetchWeather(fetchImpl, { lat: 1, lon: 2 });
    expect(periods[0].seasFt).toBeUndefined();
    expect(periods[0].windKt).toBe(12);
  });

  it('throws when the forecast fetch is not ok', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 503)) as unknown as typeof globalThis.fetch;
    await expect(fetchWeather(fetchImpl, { lat: 1, lon: 2 })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/server/conditions-weather.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/server/conditions/weather.ts`:

```ts
import type { WeatherPeriod } from '../../data/schema.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const UA = 'ShipsLog/1.0 (+conditions)';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function degToCompass(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8];
}

// Minimal WMO weather_code -> short sky text. Unknown codes leave sky undefined.
const SKY: Record<number, string> = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  61: 'Rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Snow', 73: 'Snow', 75: 'Snow',
  80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

interface ForecastJson {
  hourly?: {
    time: string[];
    temperature_2m: number[];
    wind_speed_10m: number[];
    wind_gusts_10m: number[];
    wind_direction_10m: number[];
    precipitation_probability: number[];
    weather_code: number[];
  };
}
interface MarineJson {
  hourly?: { time: string[]; wave_height: number[] };
}

/** Fetch + normalize a ~48h marine weather forecast from Open-Meteo (free, no
 *  key, global). Returns up to 16 periods at 3-hour spacing. Throws if the core
 *  forecast call fails; a failed marine (wave) call just drops seasFt. */
export async function fetchWeather(
  fetchImpl: typeof globalThis.fetch,
  location: { lat: number; lon: number },
): Promise<WeatherPeriod[]> {
  const q = `latitude=${location.lat}&longitude=${location.lon}`;
  const fUrl = `${FORECAST_URL}?${q}&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability,weather_code&forecast_days=3&temperature_unit=fahrenheit&wind_speed_unit=kn&timezone=GMT`;
  const mUrl = `${MARINE_URL}?${q}&hourly=wave_height&forecast_days=3&length_unit=imperial&timezone=GMT`;

  const [fRes, mRes] = await Promise.all([
    fetchImpl(fUrl, { headers: { 'User-Agent': UA } }),
    fetchImpl(mUrl, { headers: { 'User-Agent': UA } }),
  ]);

  if (!fRes.ok) throw new Error(`weather forecast fetch failed: ${fRes.status}`);
  const f = (await fRes.json()) as ForecastJson;
  const h = f.hourly;
  if (!h?.time?.length) throw new Error('weather forecast returned no hourly data');

  const waveByTime = new Map<string, number>();
  if (mRes.ok) {
    const m = (await mRes.json()) as MarineJson;
    m.hourly?.time.forEach((t, i) => waveByTime.set(t, m.hourly!.wave_height[i]));
  }

  const periods: WeatherPeriod[] = [];
  for (let i = 0; i < h.time.length && periods.length < 16; i += 3) {
    const t = h.time[i];
    const wave = waveByTime.get(t);
    periods.push({
      time: `${t}:00Z`,
      windDir: degToCompass(h.wind_direction_10m[i]),
      windKt: Math.round(h.wind_speed_10m[i]),
      gustKt: Math.round(h.wind_gusts_10m[i]),
      tempF: Math.round(h.temperature_2m[i]),
      seasFt: wave === undefined ? undefined : Number(wave.toFixed(1)),
      sky: SKY[h.weather_code[i]],
      precipPct: h.precipitation_probability?.[i],
    });
  }
  return periods;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/server/conditions-weather.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/conditions/weather.ts test/server/conditions-weather.test.ts
git commit -m "feat(server): Open-Meteo weather client for conditions"
```

---

### Task 8: Tides client (NOAA CO-OPS)

**Files:**
- Create: `src/server/conditions/tides.ts`
- Test: `test/server/conditions-tides.test.ts` (create)

**Interfaces:**
- Produces: `fetchTides(fetchImpl, stations: TideStation[], startDate: string): Promise<Record<string, TidePrediction[]>>`. `startDate` is `YYYYMMDD` (GMT). One CO-OPS `datagetter` call per station (`interval=hilo`, 48h, MLLW, GMT). A single station failing yields `[]` for that station (never sinks the board). Times normalized from `"YYYY-MM-DD HH:mm"` → `"YYYY-MM-DDTHH:mm:00Z"`.

- [ ] **Step 1: Write the failing test**

Create `test/server/conditions-tides.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchTides } from '../../src/server/conditions/tides.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const STATIONS = [
  { id: '8665530', name: 'Charleston', primary: true },
  { id: '8665543', name: 'Wando' },
];

describe('fetchTides', () => {
  it('fetches hi/lo predictions per station and normalizes shape', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const station = new URL(String(url)).searchParams.get('station');
      return jsonResponse({
        predictions: [
          { t: '2026-06-20 15:12', v: station === '8665530' ? '5.8' : '5.6', type: 'H' },
          { t: '2026-06-20 21:30', v: '0.4', type: 'L' },
        ],
      });
    }) as unknown as typeof globalThis.fetch;

    const out = await fetchTides(fetchImpl, STATIONS, '20260620');
    expect(Object.keys(out)).toEqual(['8665530', '8665543']);
    expect(out['8665530'][0]).toEqual({ type: 'H', time: '2026-06-20T15:12:00Z', heightFt: 5.8 });
    expect(out['8665530'][1].type).toBe('L');
    expect(out['8665543'][0].heightFt).toBe(5.6);
  });

  it('degrades a single failing station to an empty array', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const station = new URL(String(url)).searchParams.get('station');
      if (station === '8665543') return jsonResponse({}, false, 500);
      return jsonResponse({ predictions: [{ t: '2026-06-20 15:12', v: '5.8', type: 'H' }] });
    }) as unknown as typeof globalThis.fetch;

    const out = await fetchTides(fetchImpl, STATIONS, '20260620');
    expect(out['8665530']).toHaveLength(1);
    expect(out['8665543']).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/server/conditions-tides.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/server/conditions/tides.ts`:

```ts
import type { TidePrediction, TideStation } from '../../data/schema.js';

const TIDES_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const UA = 'ShipsLog/1.0 (+conditions)';

interface CoOpsJson {
  predictions?: { t: string; v: string; type: string }[];
}

/** Fetch 48h of high/low tide predictions per station from NOAA CO-OPS (free,
 *  no key, US-only). `startDate` is YYYYMMDD in GMT. Each station is fetched
 *  independently; a station that errors yields an empty list rather than failing
 *  the whole board. */
export async function fetchTides(
  fetchImpl: typeof globalThis.fetch,
  stations: TideStation[],
  startDate: string,
): Promise<Record<string, TidePrediction[]>> {
  const out: Record<string, TidePrediction[]> = {};
  await Promise.all(
    stations.map(async (st) => {
      const url =
        `${TIDES_URL}?product=predictions&application=shiplog&begin_date=${startDate}` +
        `&range=48&datum=MLLW&interval=hilo&units=english&time_zone=gmt&format=json&station=${encodeURIComponent(st.id)}`;
      try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) { out[st.id] = []; return; }
        const json = (await res.json()) as CoOpsJson;
        out[st.id] = (json.predictions ?? []).map((p) => ({
          type: p.type === 'L' ? 'L' : 'H',
          time: `${p.t.replace(' ', 'T')}:00Z`,
          heightFt: Number(p.v),
        }));
      } catch {
        out[st.id] = [];
      }
    }),
  );
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/server/conditions-tides.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/conditions/tides.ts test/server/conditions-tides.test.ts
git commit -m "feat(server): NOAA CO-OPS tides client for conditions"
```

---

### Task 9: Conditions service (TTL cache + stale-on-error)

**Files:**
- Create: `src/server/conditions/service.ts`
- Test: `test/server/conditions-service.test.ts` (create)

**Interfaces:**
- Consumes: `fetchWeather` (Task 7), `fetchTides` (Task 8), schema types.
- Produces:
  - `createConditionsService(opts?: { fetch?: typeof globalThis.fetch; now?: () => Date; weatherTtlMs?: number; tidesTtlMs?: number }): ConditionsService`
  - `interface ConditionsService { get(input: { location: ConditionLocation; stations: TideStation[] }): Promise<ConditionsReadings> }`
  - `interface ConditionsReadings { periods: WeatherPeriod[]; predictions: Record<string, TidePrediction[]>; asOf?: string; errored: boolean; error?: string }`
  - Defaults: `fetch = globalThis.fetch`, `now = () => new Date()`, `weatherTtlMs = 30*60_000`, `tidesTtlMs = 6*60*60_000`.
  - `asOf` = ISO of the **oldest** present source fetch time (so staleness reflects the stalest source); `error: 'unavailable'` + `asOf` undefined when neither source ever produced data.

- [ ] **Step 1: Write the failing test**

Create `test/server/conditions-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createConditionsService } from '../../src/server/conditions/service.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const FORECAST = {
  hourly: {
    time: ['2026-06-20T14:00'], temperature_2m: [84], wind_speed_10m: [12],
    wind_gusts_10m: [18], wind_direction_10m: [225], precipitation_probability: [10], weather_code: [2],
  },
};
const TIDES = { predictions: [{ t: '2026-06-20 15:12', v: '5.8', type: 'H' }] };

function stubFetch(): { fn: typeof globalThis.fetch; counts: { weather: number; tides: number } } {
  const counts = { weather: 0, tides: 0 };
  const fn = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('tidesandcurrents')) { counts.tides += 1; return jsonResponse(TIDES); }
    if (u.includes('marine-api')) return jsonResponse({ hourly: { time: ['2026-06-20T14:00'], wave_height: [2.5] } });
    counts.weather += 1; return jsonResponse(FORECAST);
  }) as unknown as typeof globalThis.fetch;
  return { fn, counts };
}

const INPUT = {
  location: { label: 'x', lat: 1, lon: 2 },
  stations: [{ id: '8665530', name: 'Charleston', primary: true }],
};

describe('conditions service cache', () => {
  it('fetches on first call and serves from cache within TTL', async () => {
    let nowMs = Date.parse('2026-06-20T16:00:00Z');
    const { fn, counts } = stubFetch();
    const svc = createConditionsService({ fetch: fn, now: () => new Date(nowMs) });

    const a = await svc.get(INPUT);
    expect(a.periods).toHaveLength(1);
    expect(a.predictions['8665530']).toHaveLength(1);
    expect(counts.weather).toBe(1);
    expect(counts.tides).toBe(1);

    nowMs += 10 * 60_000; // +10 min, within both TTLs
    await svc.get(INPUT);
    expect(counts.weather).toBe(1); // no refetch
    expect(counts.tides).toBe(1);
  });

  it('refetches weather after its TTL but keeps tides cached longer', async () => {
    let nowMs = Date.parse('2026-06-20T16:00:00Z');
    const { fn, counts } = stubFetch();
    const svc = createConditionsService({ fetch: fn, now: () => new Date(nowMs) });
    await svc.get(INPUT);
    nowMs += 31 * 60_000; // past 30-min weather TTL, under 6-h tides TTL
    await svc.get(INPUT);
    expect(counts.weather).toBe(2);
    expect(counts.tides).toBe(1);
  });

  it('serves last-good and flags errored when a refetch fails', async () => {
    let nowMs = Date.parse('2026-06-20T16:00:00Z');
    let failWeather = false;
    const counts = { weather: 0 };
    const fn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('tidesandcurrents')) return jsonResponse(TIDES);
      if (u.includes('marine-api')) return jsonResponse({ hourly: { time: ['2026-06-20T14:00'], wave_height: [2.5] } });
      counts.weather += 1;
      if (failWeather) return jsonResponse({}, false, 500);
      return jsonResponse(FORECAST);
    }) as unknown as typeof globalThis.fetch;
    const svc = createConditionsService({ fetch: fn, now: () => new Date(nowMs) });

    const a = await svc.get(INPUT);
    expect(a.errored).toBe(false);
    nowMs += 31 * 60_000;
    failWeather = true;
    const b = await svc.get(INPUT);
    expect(b.errored).toBe(true);
    expect(b.periods).toHaveLength(1); // last-good still served
  });

  it('reports unavailable when nothing can be fetched and there is no cache', async () => {
    const fn = vi.fn(async () => jsonResponse({}, false, 500)) as unknown as typeof globalThis.fetch;
    const svc = createConditionsService({ fetch: fn, now: () => new Date('2026-06-20T16:00:00Z') });
    const r = await svc.get(INPUT);
    expect(r.error).toBe('unavailable');
    expect(r.periods).toEqual([]);
    expect(r.asOf).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/server/conditions-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/server/conditions/service.ts`:

```ts
import type { ConditionLocation, TideStation, WeatherPeriod, TidePrediction } from '../../data/schema.js';
import { fetchWeather } from './weather.js';
import { fetchTides } from './tides.js';

export interface ConditionsReadings {
  periods: WeatherPeriod[];
  predictions: Record<string, TidePrediction[]>;
  asOf?: string;     // ISO of the oldest present source fetch; undefined if nothing succeeded
  errored: boolean;  // a refetch failed this call (last-good or empty served)
  error?: string;    // 'unavailable' when no data at all
}

export interface ConditionsService {
  get(input: { location: ConditionLocation; stations: TideStation[] }): Promise<ConditionsReadings>;
}

export interface ConditionsServiceOpts {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  weatherTtlMs?: number;
  tidesTtlMs?: number;
}

const WEATHER_TTL = 30 * 60_000;       // 30 min
const TIDES_TTL = 6 * 60 * 60_000;     // 6 h

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export function createConditionsService(opts: ConditionsServiceOpts = {}): ConditionsService {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? (() => new Date());
  const weatherTtl = opts.weatherTtlMs ?? WEATHER_TTL;
  const tidesTtl = opts.tidesTtlMs ?? TIDES_TTL;

  let weatherCache: { at: number; periods: WeatherPeriod[] } | undefined;
  let tidesCache: { at: number; predictions: Record<string, TidePrediction[]> } | undefined;

  return {
    async get({ location, stations }) {
      const t = now().getTime();
      let errored = false;

      // ---- weather ----
      if (!weatherCache || t - weatherCache.at >= weatherTtl) {
        try {
          const periods = await fetchWeather(fetchImpl, { lat: location.lat, lon: location.lon });
          weatherCache = { at: t, periods };
        } catch {
          errored = true; // keep last-good (weatherCache) if any
        }
      }

      // ---- tides ----
      if (!tidesCache || t - tidesCache.at >= tidesTtl) {
        try {
          const predictions = await fetchTides(fetchImpl, stations, yyyymmdd(now()));
          tidesCache = { at: t, predictions };
        } catch {
          errored = true; // keep last-good (tidesCache) if any
        }
      }

      const periods = weatherCache?.periods ?? [];
      const predictions = tidesCache?.predictions ?? {};
      const ats = [weatherCache?.at, tidesCache?.at].filter((x): x is number => x !== undefined);
      const asOf = ats.length ? new Date(Math.min(...ats)).toISOString() : undefined;
      const error = asOf === undefined ? 'unavailable' : undefined;

      return { periods, predictions, asOf, errored, error };
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/server/conditions-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/conditions/service.ts test/server/conditions-service.test.ts
git commit -m "feat(server): conditions service with TTL cache + stale-on-error"
```

---

### Task 10: Route + app wiring (`GET /api/conditions`)

**Files:**
- Create: `src/server/routes/conditions.ts`
- Modify: `src/server/app.ts` (add `conditions?` to `AppContext`, import + register the route)
- Test: `test/server/conditions.test.ts` (create)

**Interfaces:**
- Consumes: `ConditionsService` + `createConditionsService` (Task 9); `Config.conditionsFetch` (Task 6); `Dataset.conditions` (Task 3).
- Produces: `registerConditionsRoutes(app, ctx)`; `AppContext.conditions?: ConditionsService` (injectable for tests; defaults to a real service constructed once per app so its cache persists). Public route `GET /api/conditions` returning the response view defined in Task 5.

- [ ] **Step 1: Write the failing test**

Create `test/server/conditions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/server/config.js';
import { UsersStore } from '../../src/server/users.js';
import { createApp } from '../../src/server/app.js';
import { ShipStore } from '../../src/server/store.js';
import type { ConditionsService } from '../../src/server/conditions/service.js';
import { FIXED_NOW, DEMO } from './helpers.js';

async function appOverDemo(conditions?: ConditionsService) {
  const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
  const config = loadConfig({ USERS_PATH: usersPath }, DEMO); // demo mode (public, read-only)
  const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW, sync: false });
  const users = await UsersStore.load(usersPath);
  const app = createApp({ config, store, users, now: FIXED_NOW, conditions });
  return app;
}

describe('GET /api/conditions', () => {
  it('is public and serves agent-mode readings straight from the demo file', async () => {
    const app = await appOverDemo();
    const res = await request(app).get('/api/conditions'); // no auth
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.source).toBe('agent');
    expect(res.body.location.label).toBe('Charleston Harbor entrance');
    expect(res.body.weather.periods.length).toBeGreaterThan(0);
    expect(res.body.tides.predictions['8665530'][0].type).toBe('H');
    expect(res.body.body).toContain('sea breeze');
  });

  it('returns configured:false when no conditions.md exists', async () => {
    // A data dir with only a boat.yaml (non-demo, no git needed for a read).
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-bare-'));
    writeFileSync(join(dir, 'boat.yaml'), 'name: Test\n');
    const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
    const config = loadConfig({ DATA_DIR: dir, SESSION_SECRET: 's', COOKIE_SECURE: 'false', USERS_PATH: usersPath }, DEMO);
    const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW, sync: false });
    const users = await UsersStore.load(usersPath);
    const app = createApp({ config, store, users, now: FIXED_NOW });
    const res = await request(app).get('/api/conditions');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });

  it('api mode: merges live readings from the injected service', async () => {
    // Build a non-demo data dir whose conditions.md is api mode.
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-api-'));
    await cp(DEMO, dir, { recursive: true });
    writeFileSync(join(dir, 'conditions.md'),
      '---\nsource: api\nlocation:\n  label: "Charleston"\n  lat: 32.78\n  lon: -79.93\n' +
      'tides:\n  stations:\n    - { id: "8665530", name: "Charleston", primary: true }\n---\n');
    const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
    const config = loadConfig({ DATA_DIR: dir, SESSION_SECRET: 's', COOKIE_SECURE: 'false', USERS_PATH: usersPath }, DEMO);
    const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW, sync: false });
    const users = await UsersStore.load(usersPath);

    const fakeService: ConditionsService = {
      get: vi.fn(async () => ({
        periods: [{ time: '2026-06-20T14:00:00Z', windKt: 11 }],
        predictions: { '8665530': [{ type: 'H' as const, time: '2026-06-20T15:12:00Z', heightFt: 5.8 }] },
        asOf: '2026-06-20T13:00:00Z',
        errored: false,
      })),
    };
    const app = createApp({ config, store, users, now: FIXED_NOW, conditions: fakeService });
    const res = await request(app).get('/api/conditions');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('api');
    expect(res.body.weather.periods[0].windKt).toBe(11);
    expect(res.body.tides.stations[0].id).toBe('8665530');
    expect(fakeService.get).toHaveBeenCalledTimes(1);
  });

  it('api mode with CONDITIONS_FETCH=false degrades to unavailable without calling the service', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-ks-'));
    await cp(DEMO, dir, { recursive: true });
    writeFileSync(join(dir, 'conditions.md'),
      '---\nsource: api\nlocation:\n  label: "Charleston"\n  lat: 32.78\n  lon: -79.93\n' +
      'tides:\n  stations:\n    - { id: "8665530", name: "Charleston", primary: true }\n---\n');
    const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
    const config = loadConfig({ DATA_DIR: dir, SESSION_SECRET: 's', COOKIE_SECURE: 'false', CONDITIONS_FETCH: 'false', USERS_PATH: usersPath }, DEMO);
    const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW, sync: false });
    const users = await UsersStore.load(usersPath);
    const get = vi.fn();
    const app = createApp({ config, store, users, now: FIXED_NOW, conditions: { get } });
    const res = await request(app).get('/api/conditions');
    expect(res.status).toBe(200);
    expect(res.body.error).toBe('unavailable');
    expect(res.body.stale).toBe(true);
    expect(res.body.tides.stations[0].id).toBe('8665530'); // config still surfaces
    expect(get).not.toHaveBeenCalled();
  });
});
```

> `DEMO` and `FIXED_NOW` are already exported from `test/server/helpers.ts`. The non-demo cases that only read (no write) don't require a git repo — `ShipStore.open` over a plain dir reads fine; it only warns about commits on writes.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/server/conditions.test.ts`
Expected: FAIL — route not registered / module not found.

- [ ] **Step 3: Implement the route**

Create `src/server/routes/conditions.ts`:

```ts
import type { Express } from 'express';
import type { AppContext } from '../app.js';
import { createConditionsService, type ConditionsService } from '../conditions/service.js';

/** Readings older than this are flagged `stale` so the UI can say "updated …". */
const STALE_THRESHOLD_MS = 6 * 60 * 60_000; // 6 h

function isStale(asOf: string | undefined, now: Date): boolean {
  if (!asOf) return true;
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > STALE_THRESHOLD_MS;
}

export function registerConditionsRoutes(app: Express, ctx: AppContext): void {
  const { store, config, now } = ctx;
  // One service for the app's lifetime so the TTL cache persists across requests.
  const service: ConditionsService = ctx.conditions ?? createConditionsService({ now });

  // Public (guest-visible), same posture as /api/welcome.
  app.get('/api/conditions', async (_req, res) => {
    const cond = store.current().conditions;
    if (!cond) {
      res.json({ configured: false, stale: true });
      return;
    }

    if (cond.source === 'agent') {
      const asOf = cond.weather?.asOf;
      res.json({
        configured: true,
        source: 'agent',
        location: cond.location,
        weather: cond.weather,
        tides: cond.tides,
        body: cond.body,
        asOf,
        stale: isStale(asOf, now()),
      });
      return;
    }

    // ---- source: 'api' ----
    const stations = cond.tides?.stations ?? [];
    if (!config.conditionsFetch) {
      res.json({
        configured: true,
        source: 'api',
        location: cond.location,
        tides: { stations },
        body: cond.body,
        stale: true,
        error: 'unavailable',
      });
      return;
    }
    try {
      const readings = await service.get({ location: cond.location, stations });
      res.json({
        configured: true,
        source: 'api',
        location: cond.location,
        weather: { source: 'Open-Meteo', asOf: readings.asOf, periods: readings.periods },
        tides: { stations, predictions: readings.predictions },
        body: cond.body,
        asOf: readings.asOf,
        stale: readings.errored || isStale(readings.asOf, now()),
        ...(readings.error ? { error: readings.error } : {}),
      });
    } catch {
      res.json({
        configured: true,
        source: 'api',
        location: cond.location,
        tides: { stations },
        body: cond.body,
        stale: true,
        error: 'unavailable',
      });
    }
  });
}
```

- [ ] **Step 4: Wire into the app**

In `src/server/app.ts`:

1. Add imports near the other route imports:

```ts
import { registerConditionsRoutes } from './routes/conditions.js';
import type { ConditionsService } from './conditions/service.js';
```

2. Add `conditions` to `AppContext`:

```ts
export interface AppContext {
  config: Config;
  store: ShipStore;
  users: UsersStore;
  now: () => Date;
  assistant?: AssistantDeps;
  conditions?: ConditionsService;
}
```

3. Register the route alongside the data routes (after `registerDataRoutes(app, ctx);`):

```ts
  registerDataRoutes(app, ctx);
  registerConditionsRoutes(app, ctx);
```

- [ ] **Step 5: Run to verify pass + typecheck**

Run: `npx vitest run test/server/conditions.test.ts`
Expected: PASS (4 tests).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/conditions.ts src/server/app.ts test/server/conditions.test.ts
git commit -m "feat(server): public GET /api/conditions (agent + api modes)"
```

---

### Task 11: Redaction-golden coverage for the conditions endpoint

**Files:**
- Modify: `test/server/redaction-golden.test.ts`

**Interfaces:**
- Consumes: the public `/api/conditions` route + the demo agent-mode fixture (Task 2/10).
- Produces: a golden assertion that the all-access conditions surface is monetary-free for crew and reachable (200) by a guest. This protects the cost-redaction invariant for the new public surface.

- [ ] **Step 1: Add the failing assertions**

Append inside `describe('cost-redaction golden test', …)` in `test/server/redaction-golden.test.ts`:

```ts
  it('conditions is public and carries no monetary key (crew + guest)', async () => {
    const { app } = await buildTestApp();
    // Guest (no login) can read it — it is all-access like welcome.
    const guest = await request(app).get('/api/conditions');
    expect(guest.status).toBe(200);
    assertNoMonetaryKey(guest.body, '/api/conditions (guest)');

    // Crew sees the same money-free surface.
    const agent = request.agent(app);
    await agent.post('/api/login').send({ username: 'crew1', password: 'crewpass123' });
    const crew = await agent.get('/api/conditions');
    expect(crew.status).toBe(200);
    assertNoMonetaryKey(crew.body, '/api/conditions (crew)');
  });
```

- [ ] **Step 2: Run to verify it passes (the implementation already exists)**

Run: `npx vitest run test/server/redaction-golden.test.ts`
Expected: PASS — conditions is public and money-free. (If it fails, the route or fixture is wrong — fix there, not by weakening the assertion.)

- [ ] **Step 3: Commit**

```bash
git add test/server/redaction-golden.test.ts
git commit -m "test(server): redaction-golden covers public conditions surface"
```

---

### Task 12: ConditionsPage + nav + route wiring

**Files:**
- Create: `src/ui/pages/ConditionsPage.tsx`
- Create: `src/ui/pages/ConditionsPage.module.css`
- Modify: `src/ui/AppRouter.tsx` (public `/conditions` route)
- Modify: `src/ui/components/Shell.tsx` (nav item + crumb)
- Test: `src/ui/pages/ConditionsPage.test.tsx` (create)

**Interfaces:**
- Consumes: `api.conditions` (Task 5), `fmtTime`/`fmtRelative` (Task 4), the `Markdown` component (`src/ui/pages/Markdown.tsx`), `Icon`/atoms.
- Produces: a default-exported `ConditionsPage` rendering the weather strip, tide board (primary featured + stations grouped by `area`), optional Markdown note, stale badge, empty + unavailable states. Public route `/conditions`; nav item "Conditions" in the Aboard group (no role guard).

- [ ] **Step 1: Write the failing test**

Create `src/ui/pages/ConditionsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ConditionsPage from './ConditionsPage.js';
import { useSession, type Session } from '../state/session.js';
import { api } from '../lib/api.js';
import type { Conditions } from '../lib/types.js';

vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});
vi.mock('../lib/api.js', () => ({ api: { conditions: vi.fn() }, ApiError: class ApiError extends Error {} }));

const mockedUseSession = vi.mocked(useSession);
const mockedApi = vi.mocked(api);

function session(partial: Partial<Session> = {}): Session {
  return {
    loading: false, role: 'guest', username: null, demo: false, ownerConfigured: true,
    isOwner: false, isCrew: false, isAuthed: false,
    refresh: vi.fn(), login: vi.fn(), logout: vi.fn(), ...partial,
  };
}

const FULL: Conditions = {
  configured: true,
  source: 'agent',
  location: { label: 'Charleston Harbor entrance', lat: 32.78, lon: -79.93, asOf: '2026-06-20T13:00:00Z' },
  asOf: '2026-06-20T13:05:00Z',
  stale: false,
  weather: {
    summary: 'SW 10-15 kt, building Thursday.',
    periods: [
      { time: '2026-06-20T14:00:00Z', windDir: 'SW', windKt: 12, gustKt: 18, tempF: 84, seasFt: 2.5, sky: 'Partly cloudy', precipPct: 10 },
      { time: '2026-06-20T17:00:00Z', windDir: 'SW', windKt: 14, gustKt: 20, tempF: 86, seasFt: 2.5, sky: 'Clear', precipPct: 5 },
    ],
  },
  tides: {
    stations: [
      { id: '8665530', name: 'Charleston, Customs House', area: 'Charleston Harbor', primary: true },
      { id: '8665543', name: 'Wando River, Causeway', area: 'Wando R.' },
    ],
    predictions: {
      '8665530': [{ type: 'H', time: '2026-06-20T15:12:00Z', heightFt: 5.8 }, { type: 'L', time: '2026-06-20T21:30:00Z', heightFt: 0.4 }],
      '8665543': [{ type: 'H', time: '2026-06-20T15:48:00Z', heightFt: 5.6 }],
    },
  },
  body: 'Light **SW** sea breeze fills in by early afternoon.',
};

function renderPage(s: Session = session()): void {
  mockedUseSession.mockReturnValue(s);
  render(<MemoryRouter><ConditionsPage /></MemoryRouter>);
}

describe('ConditionsPage', () => {
  beforeEach(() => {
    mockedUseSession.mockReset();
    mockedApi.conditions.mockReset();
    mockedApi.conditions.mockResolvedValue(FULL);
  });
  afterEach(() => vi.clearAllMocks());

  it('fetches conditions on mount and shows the location label', async () => {
    renderPage();
    expect(await screen.findByText('Charleston Harbor entrance')).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.conditions).toHaveBeenCalledTimes(1));
  });

  it('renders the weather summary + at least one period card', async () => {
    renderPage();
    expect(await screen.findByText(/SW 10-15 kt/)).toBeInTheDocument();
    expect(screen.getAllByText(/kt/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Partly cloudy/)).toBeInTheDocument();
  });

  it('renders the tide board with the primary station and the other areas', async () => {
    renderPage();
    expect(await screen.findByText(/Charleston, Customs House/)).toBeInTheDocument();
    expect(screen.getByText(/Wando R\./)).toBeInTheDocument();
  });

  it('renders the Markdown note (bold becomes <strong>)', async () => {
    renderPage();
    const strong = await screen.findByText('SW');
    expect(strong.tagName).toBe('STRONG');
  });

  it('shows a stale badge when stale', async () => {
    mockedApi.conditions.mockResolvedValue({ ...FULL, stale: true });
    renderPage();
    expect(await screen.findByText(/stale|out of date/i)).toBeInTheDocument();
  });

  it('shows an empty state when not configured', async () => {
    mockedApi.conditions.mockResolvedValue({ configured: false, stale: true });
    renderPage();
    expect(await screen.findByText(/aren.t set up yet|not set up/i)).toBeInTheDocument();
  });

  it('shows an unavailable notice when error is set and omits the weather strip', async () => {
    mockedApi.conditions.mockResolvedValue({
      configured: true, source: 'api', location: { label: 'Charleston', lat: 1, lon: 2 },
      tides: { stations: [{ id: '8665530', name: 'Charleston', primary: true }] }, stale: true, error: 'unavailable',
    });
    renderPage();
    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
  });

  it('never renders a monetary figure (conditions is cost-free)', async () => {
    renderPage(session({ role: 'crew', isCrew: true, isAuthed: true }));
    await screen.findByText('Charleston Harbor entrance');
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/pages/ConditionsPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page**

Create `src/ui/pages/ConditionsPage.module.css`:

```css
.strip { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; }
.period { flex: 0 0 auto; min-width: 116px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--paper-2); }
.periodTime { font-size: 12.5px; color: var(--brass-deep); font-variant: small-caps; letter-spacing: 0.04em; }
.periodWind { font-size: 20px; font-weight: 600; color: var(--ink-800); margin-top: 4px; }
.periodMeta { font-size: 12.5px; color: var(--ink-600); margin-top: 6px; line-height: 1.5; }
.board { display: grid; grid-template-columns: 1.1fr 1fr; gap: 18px; margin-top: 8px; }
.areaGroup { margin-bottom: 12px; }
.areaLabel { font-size: 12px; color: var(--brass-deep); font-variant: small-caps; letter-spacing: 0.05em; margin-bottom: 4px; }
.stationRow { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: 14px; }
.hilo { display: inline-flex; gap: 10px; color: var(--ink-700); }
.staleBadge { color: var(--rust, #9a4a2f); }
@media (max-width: 760px) { .board { grid-template-columns: 1fr; } }
```

Create `src/ui/pages/ConditionsPage.tsx`:

```tsx
/**
 * Conditions — the all-access weather + tides page (public, like Welcome).
 * Pure API client over GET /api/conditions. In agent mode the readings come
 * straight from the data repo's conditions.md (Hermes maintains it on a cron);
 * in api mode the server fetches them live. The page renders identically either
 * way and degrades gracefully when a block is absent. Conditions carries NO cost
 * data, so it is identical for every role.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon.js';
import { SectionHead, Card } from '../components/atoms.js';
import { Markdown } from './Markdown.js';
import { api } from '../lib/api.js';
import { fmtTime, fmtRelative } from '../lib/format.js';
import type { Conditions, TidePrediction, TideStation } from '../lib/types.js';
import styles from './ConditionsPage.module.css';

function nextOf(preds: TidePrediction[] | undefined, type: 'H' | 'L', now: Date): TidePrediction | undefined {
  if (!preds) return undefined;
  const upcoming = preds.filter((p) => p.type === type && Date.parse(p.time) >= now.getTime());
  return (upcoming[0] ?? preds.filter((p) => p.type === type).at(-1)) || undefined;
}

function StationLine({ st, preds, now }: { st: TideStation; preds?: TidePrediction[]; now: Date }): JSX.Element {
  const hi = nextOf(preds, 'H', now);
  const lo = nextOf(preds, 'L', now);
  return (
    <div className={styles.stationRow}>
      <span>{st.name}</span>
      <span className={styles.hilo}>
        <span>▲ {hi ? fmtTime(hi.time) : '—'}</span>
        <span>▼ {lo ? fmtTime(lo.time) : '—'}</span>
      </span>
    </div>
  );
}

export default function ConditionsPage(): JSX.Element {
  const [data, setData] = useState<Conditions | null>(null);
  const now = new Date();

  useEffect(() => {
    let alive = true;
    api.conditions()
      .then((c) => { if (alive) setData(c); })
      .catch(() => { /* public + non-critical; keep the loading state on a hiccup */ });
    return () => { alive = false; };
  }, []);

  if (!data) {
    return (
      <div className="page fade-in">
        <div className="page-wrap" data-testid="conditions-loading"><p className="muted">Loading…</p></div>
      </div>
    );
  }

  if (!data.configured) {
    return (
      <div className="page fade-in">
        <div className="page-wrap" style={{ maxWidth: 720 }}>
          <SectionHead icon="waves" title="Conditions" />
          <Card pad>
            <p className="muted">Conditions aren&rsquo;t set up yet. Add a <code>conditions.md</code> to the
              data repo (location + tide stations) to show live weather and tides here.</p>
          </Card>
        </div>
      </div>
    );
  }

  const { location, weather, tides, body, asOf, stale, error } = data;
  const stations = tides?.stations ?? [];
  const primary = stations.find((s) => s.primary) ?? stations[0];
  const rest = stations.filter((s) => s !== primary);
  // Group the non-primary stations by area (preserving first-seen order).
  const byArea = new Map<string, TideStation[]>();
  for (const s of rest) {
    const key = s.area ?? 'Other';
    byArea.set(key, [...(byArea.get(key) ?? []), s]);
  }

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1080 }}>
        <div className="flex items-center gap-12" style={{ flexWrap: 'wrap', marginBottom: 6 }}>
          <SectionHead icon="waves" title="Conditions" />
        </div>
        <div className="flex items-center gap-12" style={{ flexWrap: 'wrap', marginTop: -8, marginBottom: 16 }}>
          {location && <span className="coord"><Icon name="pin" s={14} /> {location.label}</span>}
          {asOf && <span className="muted" style={{ fontSize: 13 }}>Updated {fmtRelative(asOf, now)}</span>}
          {stale && <span className={`badge ${styles.staleBadge}`}>May be out of date</span>}
        </div>

        {error === 'unavailable' && (
          <Card pad><p className="muted"><Icon name="alert" s={16} /> Live conditions are unavailable right now. Check back shortly.</p></Card>
        )}

        {/* ---------- WEATHER ---------- */}
        {weather?.periods && weather.periods.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <SectionHead icon="wind" title="Marine forecast" />
            {weather.summary && <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>{weather.summary}</p>}
            <div className={styles.strip}>
              {weather.periods.map((p) => (
                <div key={p.time} className={styles.period}>
                  <div className={styles.periodTime}>{fmtTime(p.time)}</div>
                  <div className={styles.periodWind}>
                    {p.windDir ?? ''} {p.windKt ?? '—'}<span style={{ fontSize: 13 }}> kt</span>
                  </div>
                  <div className={styles.periodMeta}>
                    {p.gustKt !== undefined && <>gust {p.gustKt} kt<br /></>}
                    {p.seasFt !== undefined && <>seas {p.seasFt} ft<br /></>}
                    {p.tempF !== undefined && <>{p.tempF}°F<br /></>}
                    {p.sky && <>{p.sky}<br /></>}
                    {p.precipPct !== undefined && <>{p.precipPct}% precip</>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---------- TIDES ---------- */}
        {stations.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <SectionHead icon="waves" title="Tides" />
            <div className={styles.board}>
              {primary && (
                <Card pad>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Nearest · {primary.area ?? 'Here'}</div>
                  <h3 style={{ fontSize: 19 }}>{primary.name}</h3>
                  <div className="flex gap-12" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                    <div><div className="muted tiny">Next high</div><div style={{ fontSize: 18 }}>▲ {fmtTime(nextOf(tides?.predictions?.[primary.id], 'H', now)?.time)}</div></div>
                    <div><div className="muted tiny">Next low</div><div style={{ fontSize: 18 }}>▼ {fmtTime(nextOf(tides?.predictions?.[primary.id], 'L', now)?.time)}</div></div>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    {(tides?.predictions?.[primary.id] ?? []).map((p) => (
                      <div key={p.time} className={styles.stationRow}>
                        <span>{p.type === 'H' ? '▲ High' : '▼ Low'}</span>
                        <span>{fmtTime(p.time)}{p.heightFt !== undefined ? ` · ${p.heightFt} ft` : ''}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              <Card pad>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Around the harbor</div>
                {[...byArea.entries()].map(([area, list]) => (
                  <div key={area} className={styles.areaGroup}>
                    <div className={styles.areaLabel}>{area}</div>
                    {list.map((s) => (
                      <StationLine key={s.id} st={s} preds={tides?.predictions?.[s.id]} now={now} />
                    ))}
                  </div>
                ))}
              </Card>
            </div>
          </div>
        )}

        {/* ---------- AGENT NOTE ---------- */}
        {body && (
          <div style={{ marginTop: 28 }}>
            <Card pad><Markdown source={body} /></Card>
          </div>
        )}
      </div>
    </div>
  );
}
```

> Verified module shapes (already reflected above): `Markdown` is a **named** export of `src/ui/pages/Markdown.tsx` with signature `Markdown({ source, className })` — use `import { Markdown }` and the `source` prop. `Card` is `Card({ pad, className, style, children })` — pass `pad` for padding. `SectionHead` is `SectionHead({ icon, title, action })`. Icons `waves`, `wind`, `pin`, `alert` all exist in `Icon.tsx`. The page test mocks only `api` + `useSession`; the real `Markdown`/atoms render.

- [ ] **Step 4: Wire the route + nav**

In `src/ui/AppRouter.tsx`:

1. Import the page (with the other page imports):

```ts
import ConditionsPage from './pages/ConditionsPage.js';
```

2. Add a public route next to Welcome (inside `<Route element={<ShellLayout />}>`):

```tsx
        <Route path="/" element={<WelcomePage />} />
        <Route path="/conditions" element={<ConditionsPage />} />
```

In `src/ui/components/Shell.tsx`:

3. Add the nav item to the **Aboard** group (no `show` guard → visible to everyone):

```ts
  { group: 'Aboard', items: [
    { to: '/', label: 'Welcome', icon: 'helm' },
    { to: '/conditions', label: 'Conditions', icon: 'waves' },
  ] },
```

4. Add the crumb:

```ts
  conditions: 'Conditions',
```

- [ ] **Step 5: Run the page test + typecheck**

Run: `npx vitest run src/ui/pages/ConditionsPage.test.tsx`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors (fix any atoms/Markdown prop-name mismatches surfaced).

- [ ] **Step 6: Commit**

```bash
git add src/ui/pages/ConditionsPage.tsx src/ui/pages/ConditionsPage.module.css src/ui/pages/ConditionsPage.test.tsx src/ui/AppRouter.tsx src/ui/components/Shell.tsx
git commit -m "feat(ui): Conditions page + public route + Aboard nav item"
```

---

### Task 13: Data-template fixtures, update-conditions skill, and docs

**Files:**
- Create: `data-template/conditions.md`
- Create: `data-template/.claude/skills/update-conditions/SKILL.md`
- Create: `demo/.claude/skills/update-conditions/SKILL.md` (byte-identical copy)
- Modify: `data-template/AGENTS.md` → byte-copy to `demo/AGENTS.md`
- Modify: `data-template/SCHEMA.md` → byte-copy to `demo/SCHEMA.md`
- Modify: `README.md`, `CLAUDE.md`
- Test: `test/data/cowork-docs-mirror.test.ts` (append a mirror assertion for the new skill)

**Interfaces:**
- Produces: forker-facing conditions config + example, the agentic refresh skill (mirrored template⇄demo), and updated docs. No new runtime behavior — this task makes the feature discoverable and keeps the doc-mirror/drift guards honest.

- [ ] **Step 1: Create the data-template config + example**

Create `data-template/conditions.md` (config-only starter; both modes documented in comments):

```markdown
---
# Conditions feed for the all-access Conditions page (weather + tides).
# Pick ONE source:
#   source: api    -> the app fetches live weather (Open-Meteo) + tides (NOAA, US only)
#   source: agent  -> a Cowork/Hermes agent fills weather+tides on a cron (see
#                     .claude/skills/update-conditions). Works worldwide.
source: api
location:
  label: "Home port"      # human-readable area shown on the page
  lat: 0.0                 # decimal degrees; drives the weather fetch
  lon: 0.0
tides:
  # Curated NOAA CO-OPS station ids, nearest first. Look stations up at
  # https://tidesandcurrents.noaa.gov/  (US only). Mark the nearest primary: true.
  stations: []
    # - { id: "0000000", name: "Nearest station", area: "Home Harbor", primary: true }
    # - { id: "0000001", name: "Up the river",   area: "North River" }
# In agent mode the agent ALSO writes weather.periods and tides.predictions here;
# in api mode leave them out — the server fills them. Full worked agent-mode
# example: see SCHEMA.md (Conditions section).
---

<!-- Optional free-text "conditions note" (rendered as Markdown on the page). -->
```

> Do NOT add an `examples/conditions.md` — `test/data/data-template.test.ts` pins
> `examples/` to exactly one file per record collection (6). Conditions is a
> singleton, not a collection; its full worked example lives in `SCHEMA.md`
> (Step 3) and the commented `conditions.md` above.

- [ ] **Step 2: Create the update-conditions skill (canonical, then byte-copy)**

Create `data-template/.claude/skills/update-conditions/SKILL.md`:

```markdown
---
name: update-conditions
description: Use on a schedule (a cron the owner sets) to refresh the boat's Conditions feed — rewrite conditions.md with current marine weather and tide predictions for the boat's location and curated stations, then commit and push. Operates only on a git clone of the data repo, never the running app's API.
---

# update-conditions

Keep `conditions.md` fresh so the app's all-access **Conditions** page shows
current marine weather and tides. The app pulls your push on its sync timer —
you only edit files + commit/push; never call an app API endpoint.

## When this runs

On whatever cron the owner schedules (e.g. every 3–6 hours). Each run is one
refresh of `conditions.md` in the data-repo clone.

## Steps

1. **Read `conditions.md`** for `location` (lat/lon + label) and the curated
   `tides.stations` list. If `source` is not already `agent`, set it to `agent`
   (you are now the filler).
2. **Get the marine weather** for `location` out ~48 hours from any source you
   trust (NWS marine zone text, Open-Meteo, etc.). Fill `weather.summary`,
   `weather.source`, `weather.asOf` (now, ISO-8601 Z), and `weather.periods[]`
   (`time`, and any of `windDir`, `windKt`, `gustKt`, `tempF`, `seasFt`, `sky`,
   `precipPct`). 3-hour spacing is plenty.
3. **Get tide predictions** (high/low) out ~48 hours for EACH station id in
   `tides.stations`. NOAA CO-OPS works for US stations; use a regional source
   elsewhere. Fill `tides.predictions` keyed by station id with `{ type: H|L,
   time (ISO Z), heightFt }`.
4. **Optionally** write a short prose note in the body (a one-paragraph "what to
   expect on the water"). It renders as Markdown.
5. **Validate** the field shapes against `SCHEMA.md` (Conditions section) — the
   app fails loud on an invalid `conditions.md`.
6. **Commit & push** just `conditions.md` with a message like
   `chore(conditions): refresh weather + tides`.

## Rules

- Edit files in the clone only; do NOT hit the app's REST API.
- `lat`/`lon` are decimal degrees; all times are ISO-8601 with a `Z`.
- Keep the curated station list as the owner set it — refresh predictions, don't
  reshuffle the stations unless asked.
- Conditions has NO cost data; never paste cost/owner-sensitive figures here.
```

Then byte-copy it to the demo dataset:

```bash
mkdir -p demo/.claude/skills/update-conditions
cp data-template/.claude/skills/update-conditions/SKILL.md demo/.claude/skills/update-conditions/SKILL.md
```

- [ ] **Step 3: Add the Conditions section to AGENTS.md + SCHEMA.md (canonical), then byte-copy to demo**

Append a **Conditions** section to `data-template/SCHEMA.md` documenting the singleton: the file is `conditions.md` (not a collection — no id prefix); `source: agent | api`; `location { label, lat, lon, asOf? }`; `weather { asOf?, source?, summary?, periods[] }` with `periods[]` fields `{ time, windDir?, windKt?, gustKt?, tempF?, seasFt?, sky?, precipPct? }`; `tides { stations[] { id, name, area?, primary? }, predictions: <stationId> -> { type: H|L, time, heightFt? }[] }`; note **NOAA tides are US-only** (agent mode works worldwide); and that Conditions carries **no monetary/cost data**. Include the full worked agent-mode example (the relocated former examples file) so a writer sees the complete shape:

````markdown
```yaml
source: agent
location:
  label: "Charleston Harbor entrance"
  lat: 32.7765
  lon: -79.9311
  asOf: 2026-06-20T13:00:00Z
weather:
  asOf: 2026-06-20T13:05:00Z
  source: "NWS marine zone AMZ330"
  summary: "SW 10-15 kt, seas 2-3 ft, building Thursday."
  periods:
    - { time: 2026-06-20T14:00:00Z, windDir: SW, windKt: 12, gustKt: 18, tempF: 84, seasFt: 2.5, sky: "Partly cloudy", precipPct: 10 }
tides:
  stations:
    - { id: "8665530", name: "Charleston, Customs House Wharf", area: "Charleston Harbor", primary: true }
    - { id: "8665543", name: "Wando River, Causeway", area: "Wando R." }
  predictions:
    "8665530":
      - { type: H, time: 2026-06-20T15:12:00Z, heightFt: 5.8 }
      - { type: L, time: 2026-06-20T21:30:00Z, heightFt: 0.4 }
```
````

Append a short **Conditions** note to `data-template/AGENTS.md`: the `conditions.md` singleton exists, is all-access (no cost data), is maintained by the `update-conditions` skill on a cron, and points at `SCHEMA.md` for the field shape.

Then byte-copy both to demo:

```bash
cp data-template/AGENTS.md demo/AGENTS.md
cp data-template/SCHEMA.md demo/SCHEMA.md
```

- [ ] **Step 4: Update README.md + CLAUDE.md**

In `README.md`: add `CONDITIONS_FETCH` to the config table (default `true`; set `false` to forbid server-side weather/tide fetches), and a short "Conditions" subsection explaining the two modes and the US-only tides limitation (agent mode is global).

In `CLAUDE.md`: add a "Conditions" section near the Web UI / pages sections describing: the `conditions.md` singleton + optional `Dataset.conditions`; the public `GET /api/conditions` (agent serves the file, api fetches live via `src/server/conditions/` with a TTL cache + `CONDITIONS_FETCH` kill-switch); the page is all-access with no cost data (redaction-golden covers it); and the same-change rule (touching the conditions schema/fetchers means updating `SCHEMA.md`/`AGENTS.md` + this section together).

- [ ] **Step 5: Add the skill-mirror assertion**

Append to `test/data/cowork-docs-mirror.test.ts` (inside the `describe('Cowork docs — data-template ⇄ demo byte mirror', …)` block):

```ts
  it('demo/.claude/skills/update-conditions/SKILL.md mirrors the template', () => {
    const canonical = readFileSync(join(TEMPLATE, '.claude/skills/update-conditions/SKILL.md'));
    const mirror = readFileSync(join(DEMO, '.claude/skills/update-conditions/SKILL.md'));
    expect(mirror.equals(canonical)).toBe(true);
  });
```

- [ ] **Step 6: Run the doc guards + full suite**

Run: `npx vitest run test/data/cowork-docs-mirror.test.ts test/data/p3-doc-drift-golden.test.ts test/data/data-template.test.ts`
Expected: PASS (byte mirrors match; drift guard green; data-template still loads).

> `data-template.test.ts` asserts only the six **record collections** are empty and that `examples/` holds exactly six files — the template `conditions.md` is valid config (not a record), and we added NO `examples/conditions.md`, so both invariants hold unchanged. `loadDataset(TEMPLATE)` now also parses `conditions.md`; confirm it stays schema-valid (the minimal `source: api` + `location` placeholder + empty `stations` validates).

- [ ] **Step 7: Commit**

```bash
git add data-template/ demo/ README.md CLAUDE.md test/data/cowork-docs-mirror.test.ts
git commit -m "docs(conditions): template config, update-conditions skill, AGENTS/SCHEMA/README/CLAUDE"
```

---

### Task 14: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: ALL tests pass (both `server` and `ui` projects), including the new conditions, format, config, and redaction-golden cases.

- [ ] **Step 2: Typecheck both projects**

Run: `npm run typecheck`
Expected: no errors in either `tsconfig.json` or `tsconfig.ui.json`.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run the app in demo mode and the UI dev server (two terminals): `npm run dev` and `npm run dev:ui`, then open the SPA and visit **Conditions** from the Aboard nav. Confirm: the Charleston sample weather strip + tide board render, the agent note shows, and the page is reachable as a guest (no login).

- [ ] **Step 4: Final commit (if any smoke fixes were needed)**

```bash
git add -A
git commit -m "chore(conditions): verification fixes"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- Public Conditions page, Aboard nav → Task 12.
- `conditions.md` singleton + `source: agent|api` + schema → Tasks 1, 3.
- Public `GET /api/conditions`, agent vs api fillers → Task 10.
- Open-Meteo weather + NOAA tides clients, TTL cache, stale-on-error → Tasks 7, 8, 9.
- `CONDITIONS_FETCH` kill-switch → Tasks 6, 10.
- Curated tide stations (primary + spanning, grouped by area) → schema (Task 1), page (Task 12).
- Graceful degradation (empty / unavailable / missing blocks) → Task 12.
- Demo + template fixtures (worked example relocated into SCHEMA.md to keep the pinned `examples/` count) → Tasks 2, 13.
- update-conditions agent skill + cron docs → Task 13.
- AGENTS.md/SCHEMA.md/README.md/CLAUDE.md + mirror/drift guards → Task 13.
- Redaction-golden covers the all-access surface → Task 11.
- CSP untouched (server-side fetch only) → enforced by design; no CSP edits anywhere.
- 48h horizon for weather + tides → weather client takes every 3rd hour to 16 periods (~48h); tides `range=48`.

**Type consistency:** `Conditions`/`ConditionLocation`/`WeatherPeriod`/`TideStation`/`TidePrediction`/`Tides` defined once in `schema.ts` (Task 1); the server fetchers + service consume those exact names (Tasks 7–9); the route response view + the UI `Conditions` view interface (Tasks 5, 10, 12) share field names (`configured`, `source`, `location`, `weather.periods`, `tides.stations`, `tides.predictions`, `body`, `asOf`, `stale`, `error`). `ConditionsService.get` signature is identical in service (Task 9), AppContext (Task 10), and the route's fallback construction.

**Placeholder scan:** no TBD/TODO. Every code step shows complete code; doc steps (Task 13 Steps 3–4) specify the exact content to add (prose docs) rather than code, with the byte-copy + guard tests enforcing correctness. Module shapes referenced by the page (Markdown/Card/SectionHead/Icon) were verified against source and corrected inline (named `Markdown` + `source` prop; `Card pad`).
