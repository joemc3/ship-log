# Ship's Log — P1a: Data Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless data layer for Ship's Log — parse/serialize the Markdown+YAML record files, validate them against schemas, load a data directory into an in-memory dataset, resolve cross-links, compute derived views (inventory tasks + attention rollup), and search — all as pure, unit-tested TypeScript with no server or browser.

**Architecture:** A `src/data/` library. A generic frontmatter engine round-trips files ↔ `{ data, body }`. Per-collection Zod schemas validate records and double as TS types. A **monetary-field registry** tags cost-bearing fields now so the later server-side redaction (P1b) has a single source of truth. `loadDataset()` reads a data dir into a typed `Dataset`; pure functions over that dataset do link-integrity, derived rollups (clock injected for testability), and search.

**Tech Stack:** TypeScript (ESM, Node 20+), Vitest, `gray-matter` (Markdown frontmatter), `yaml` (standalone `.yaml` files), `zod` (schemas + inferred types).

---

## File Structure

```
ship-log/  (= repo root, /Users/joemc3/tmp/sailing)
  package.json
  tsconfig.json
  vitest.config.ts
  README.md                     # created Task 1
  CLAUDE.md                     # created Task 1 (carries the doc-upkeep rule)
  src/data/
    record.ts                   # generic frontmatter parse/serialize
    schema.ts                   # zod schemas for every collection + inferred types
    monetary.ts                 # MONETARY_FIELDS + OWNER_ONLY_COLLECTIONS registry
    dataset.ts                  # loadDataset(dir) -> Dataset
    links.ts                    # checkLinkIntegrity(dataset) -> BrokenLink[]
    derive.ts                   # deriveInventoryTasks / deriveAttention (clock injected)
    search.ts                   # search(dataset, query) -> SearchHit[]
    index.ts                    # barrel export (public data-layer API)
  test/data/
    record.test.ts
    schema.test.ts
    monetary.test.ts
    dataset.test.ts
    links.test.ts
    derive.test.ts
    search.test.ts
  demo/                         # sample Valkyrie dataset (also the P1c demo seed)
    boat.yaml
    quickref.yaml
    trips/      maintenance/   costs/   vendors/   inventory/   manuals/
```

Each `src/data/*.ts` file has one responsibility. `index.ts` is the only surface the server (P1b) imports from.

---

### Task 1: Project scaffold + docs

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (append), `README.md`, `CLAUDE.md`
- Create dirs: `src/data/`, `test/data/`, `demo/{trips,maintenance,costs,vendors,inventory,manuals}/`

- [ ] **Step 1: Initialize the package and install dev/runtime deps**

Run:
```bash
cd /Users/joemc3/tmp/sailing
npm init -y
npm pkg set type="module"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
npm pkg set scripts.typecheck="tsc --noEmit"
npm install gray-matter yaml zod
npm install -D typescript vitest @types/node
```
Expected: `node_modules/` created; `package.json` lists the deps.

- [ ] **Step 2: Add `tsconfig.json`**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Add `vitest.config.ts`**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Append build artifacts to `.gitignore`**

Append to `.gitignore`:
```
node_modules/
dist/
```

- [ ] **Step 5: Create the directory tree**

Run:
```bash
mkdir -p src/data test/data demo/trips demo/maintenance demo/costs demo/vendors demo/inventory demo/manuals
```

- [ ] **Step 6: Create `README.md`**

Create `README.md`:
```markdown
# Ship's Log

A reusable, git-backed, self-hostable boat-management hub. Fork it, point it at
your own boat's data repo, and go. See the design spec in
`docs/superpowers/specs/2026-06-14-ship-log-design.md`.

## Status

In development. Phase P1a (data core) is the first deliverable: a headless,
unit-tested data layer (`src/data/`). The server, auth, and UI follow in later
plans.

## Develop

```bash
npm install
npm test            # run the suite once
npm run test:watch  # watch mode
npm run typecheck   # tsc --noEmit
```

## Layout

- `src/data/` — the data layer (parse/validate/load/derive/search).
- `demo/` — a sample "Valkyrie" dataset used by tests and demo mode.
- `docs/` — design spec and implementation plans.
```

- [ ] **Step 7: Create `CLAUDE.md`**

Create `CLAUDE.md`:
```markdown
# CLAUDE.md — Ship's Log conventions

Project rules and conventions. Grown as we build. See the design spec at
`docs/superpowers/specs/2026-06-14-ship-log-design.md`.

## Doc-upkeep rule (required)

Every change MUST verify that `README.md` and this `CLAUDE.md` are still accurate
and update them if not. Treat "are README.md and CLAUDE.md still correct?" as part
of finishing any change, before claiming it done.

## Stack & layout

- TypeScript, ESM, Node 20+. Test with Vitest (`npm test`).
- TDD: write the failing test first, then the minimal implementation.
- `src/data/` is the headless data layer; one responsibility per file; the server
  imports only from `src/data/index.ts`.

## Security invariant — cost data is owner-only

Cost/monetary data is visible to `owner` only. It MUST be redacted **server-side**
for `crew`/`guest`, never just hidden in the UI. The set of monetary fields lives
in `src/data/monetary.ts` (`MONETARY_FIELDS`, `OWNER_ONLY_COLLECTIONS`); keep it in
sync with the schemas (a test enforces this). When you add a cost-bearing field,
add it to that registry in the same change.
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Ship's Log app (TS + Vitest) with README and CLAUDE.md"
```

---

### Task 2: Generic frontmatter record engine

**Files:**
- Create: `src/data/record.ts`
- Test: `test/data/record.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/data/record.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseRecord, serializeRecord } from '../../src/data/record.js';

describe('record engine', () => {
  it('parses frontmatter and body', () => {
    const file = ['---', 'id: t-2024-06-22', 'title: Shakedown', '---', '', 'Great sail.'].join('\n');
    const { data, body } = parseRecord(file);
    expect(data).toEqual({ id: 't-2024-06-22', title: 'Shakedown' });
    expect(body).toBe('Great sail.');
  });

  it('round-trips data and body without loss', () => {
    const data = { id: 'm-jib', title: 'Replace halyard', priority: 1, photos: ['photos/a.jpg'] };
    const body = 'Several broken strands.\n\n## Steps\n- [ ] Measure.';
    const reparsed = parseRecord(serializeRecord(data, body));
    expect(reparsed.data).toEqual(data);
    expect(reparsed.body).toBe(body);
  });

  it('handles an empty body', () => {
    const reparsed = parseRecord(serializeRecord({ id: 'c-x', amount: 95 }, ''));
    expect(reparsed.data).toEqual({ id: 'c-x', amount: 95 });
    expect(reparsed.body).toBe('');
  });

  it('keeps a bare ISO date in frontmatter as a string (no Date coercion) and round-trips it', () => {
    const file = ['---', 'id: t-2024-06-22', 'date: 2024-06-22', '---', '', 'Sailed.'].join('\n');
    const { data } = parseRecord(file);
    expect(typeof data.date).toBe('string');
    expect(data.date).toBe('2024-06-22');

    const reparsed = parseRecord(serializeRecord({ id: 't-2024-06-22', date: '2024-06-22' }, 'Sailed.'));
    expect(typeof reparsed.data.date).toBe('string');
    expect(reparsed.data.date).toBe('2024-06-22');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- record`
Expected: FAIL — cannot resolve `../../src/data/record.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/record.ts`:
```ts
import matter from 'gray-matter';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// Use the `yaml` package (YAML 1.2 core schema) as gray-matter's YAML engine so
// frontmatter values parse predictably. Notably, bare ISO dates like
// `date: 2024-06-22` stay STRINGS — js-yaml's default schema would coerce them to
// Date objects, which would then fail our `z.string()` date fields downstream.
const engines = {
  yaml: {
    parse: (s: string) => parseYaml(s) as object,
    stringify: (o: object) => stringifyYaml(o),
  },
};

/**
 * Parse a Markdown+YAML-frontmatter file into structured data + body.
 * The body is trimmed intentionally: bodies are narrative Markdown, where
 * leading/trailing blank lines are not significant.
 */
export function parseRecord(fileContents: string): { data: Record<string, unknown>; body: string } {
  const parsed = matter(fileContents, { engines });
  return { data: parsed.data as Record<string, unknown>, body: parsed.content.trim() };
}

/** Serialize structured data + body back into a Markdown+YAML-frontmatter file. */
export function serializeRecord(data: Record<string, unknown>, body: string): string {
  return matter.stringify(body, data, { engines });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- record`
Expected: PASS (4 tests). If body round-trip fails on trailing whitespace, confirm `parseRecord` trims and the test bodies have no leading/trailing blank lines.

- [ ] **Step 5: Commit**

```bash
git add src/data/record.ts test/data/record.test.ts
git commit -m "feat(data): generic frontmatter parse/serialize round-trip"
```

---

### Task 3: Monetary-field registry

**Files:**
- Create: `src/data/monetary.ts`
- Test: `test/data/monetary.test.ts`

This task creates the registry first; Task 4's schema-consistency test (added in Task 9) will assert every listed field exists in its schema. For now we test the registry's own shape.

- [ ] **Step 1: Write the failing test**

Create `test/data/monetary.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MONETARY_FIELDS, OWNER_ONLY_COLLECTIONS, isMonetaryField } from '../../src/data/monetary.js';

describe('monetary registry', () => {
  it('marks costEst on maintenance and amount on cost as monetary', () => {
    expect(MONETARY_FIELDS.maintenance).toContain('costEst');
    expect(MONETARY_FIELDS.cost).toContain('amount');
  });

  it('treats the entire cost collection as owner-only', () => {
    expect(OWNER_ONLY_COLLECTIONS).toContain('cost');
  });

  it('isMonetaryField answers per collection', () => {
    expect(isMonetaryField('maintenance', 'costEst')).toBe(true);
    expect(isMonetaryField('maintenance', 'title')).toBe(false);
    expect(isMonetaryField('trip', 'title')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- monetary`
Expected: FAIL — cannot resolve `monetary.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/monetary.ts`:
```ts
/** Collections whose every record is owner-only (never sent to crew/guest). */
export const OWNER_ONLY_COLLECTIONS = ['cost'] as const;

/** Per-collection list of cost-bearing fields to strip from non-owner responses. */
export const MONETARY_FIELDS: Record<string, string[]> = {
  maintenance: ['costEst'],
  cost: ['amount'],
};

export function isMonetaryField(collection: string, field: string): boolean {
  return (MONETARY_FIELDS[collection] ?? []).includes(field);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- monetary`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/monetary.ts test/data/monetary.test.ts
git commit -m "feat(data): monetary-field registry for later cost redaction"
```

---

### Task 4: Trip schema (with partial-but-valid)

**Files:**
- Create: `src/data/schema.ts`
- Test: `test/data/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/data/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { tripSchema } from '../../src/data/schema.js';

describe('tripSchema', () => {
  it('accepts a fully populated trip', () => {
    const trip = {
      id: 't-2024-06-22', title: 'Shakedown to Gull Point', date: '2024-06-22',
      durationHrs: 5.5, crew: ['Skipper', 'Dana R.'],
      waypoints: [{ name: 'Marina', type: 'depart', time: '10:15', note: 'Motored out' }],
      findings: [{ text: 'Jib halyard frayed.', severity: 'high', maintId: 'm-jib-halyard' }],
      photos: ['photos/t-2024-06-22-01.jpg'],
    };
    expect(tripSchema.parse(trip)).toMatchObject({ id: 't-2024-06-22' });
  });

  it('accepts a partial-but-valid trip (only id + date; narrative lives in the body)', () => {
    expect(() => tripSchema.parse({ id: 't-2024-07-01', date: '2024-07-01' })).not.toThrow();
  });

  it('rejects a trip missing the required date', () => {
    expect(() => tripSchema.parse({ id: 't-2024-07-01' })).toThrow();
  });

  it('rejects a bad waypoint type', () => {
    const bad = { id: 't-x', date: '2024-07-01', waypoints: [{ name: 'X', type: 'teleport' }] };
    expect(() => tripSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- schema`
Expected: FAIL — cannot resolve `schema.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/schema.ts`:
```ts
import { z } from 'zod';

export const waypointSchema = z.object({
  name: z.string(),
  type: z.enum(['depart', 'anchor', 'arrive', 'waypoint']),
  time: z.string().optional(),
  note: z.string().optional(),
});

export const findingSchema = z.object({
  text: z.string(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  maintId: z.string().optional(),
});

export const tripSchema = z.object({
  id: z.string().regex(/^t-\d{4}-\d{2}-\d{2}(-.+)?$/),
  title: z.string().optional(),
  date: z.string(),
  durationHrs: z.number().optional(),
  distanceNm: z.number().optional(),
  engineHrs: z.number().optional(),
  sky: z.string().optional(),
  wind: z.string().optional(),
  seas: z.string().optional(),
  tempF: z.number().optional(),
  crew: z.array(z.string()).optional(),
  waypoints: z.array(waypointSchema).optional(),
  findings: z.array(findingSchema).optional(),
  photos: z.array(z.string()).optional(),
});
export type Trip = z.infer<typeof tripSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- schema`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/schema.ts test/data/schema.test.ts
git commit -m "feat(data): trip schema with partial-entry support"
```

---

### Task 5: Maintenance schema

**Files:**
- Modify: `src/data/schema.ts`
- Test: `test/data/schema.test.ts`

- [ ] **Step 1: Write the failing test (append to `schema.test.ts`)**

Add to `test/data/schema.test.ts`:
```ts
import { maintenanceSchema } from '../../src/data/schema.js';

describe('maintenanceSchema', () => {
  it('accepts a full maintenance item with a cost estimate', () => {
    const m = {
      id: 'm-jib-halyard', title: 'Replace frayed jib halyard', system: 'Rigging',
      status: 'overdue', priority: 1, opened: '2024-06-22', due: '2024-06-30',
      completed: null, costEst: 95, vendorId: 'v-sailloft', fromTripId: 't-2024-06-22',
    };
    expect(maintenanceSchema.parse(m)).toMatchObject({ status: 'overdue', costEst: 95 });
  });

  it('accepts a partial item (id + title + status only)', () => {
    expect(() => maintenanceSchema.parse({ id: 'm-x', title: 'Check bilge', status: 'scheduled' })).not.toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => maintenanceSchema.parse({ id: 'm-x', title: 'X', status: 'maybe' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- schema`
Expected: FAIL — `maintenanceSchema` is not exported.

- [ ] **Step 3: Write minimal implementation (append to `schema.ts`)**

Add to `src/data/schema.ts`:
```ts
export const maintStatusSchema = z.enum(['overdue', 'due', 'scheduled', 'done']);

export const maintenanceSchema = z.object({
  id: z.string().regex(/^m-/),
  title: z.string(),
  system: z.string().optional(),
  status: maintStatusSchema,
  priority: z.number().int().optional(),
  opened: z.string().optional(),
  due: z.string().optional(),
  completed: z.string().nullable().optional(),
  costEst: z.number().optional(), // MONETARY — see monetary.ts
  vendorId: z.string().optional(),
  fromTripId: z.string().optional(),
  photos: z.array(z.string()).optional(),
});
export type Maintenance = z.infer<typeof maintenanceSchema>;
export type MaintStatus = z.infer<typeof maintStatusSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- schema`
Expected: PASS (now 7 tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/data/schema.ts test/data/schema.test.ts
git commit -m "feat(data): maintenance schema"
```

---

### Task 6: Cost schema

**Files:**
- Modify: `src/data/schema.ts`
- Test: `test/data/schema.test.ts`

- [ ] **Step 1: Write the failing test (append)**

Add to `test/data/schema.test.ts`:
```ts
import { costSchema } from '../../src/data/schema.js';

describe('costSchema', () => {
  it('accepts a cost record', () => {
    const c = { id: 'c-jib-halyard', date: '2024-07-02', category: 'Rigging', item: 'New halyard line', amount: 92.5, vendorId: 'v-sailloft', maintId: 'm-jib-halyard' };
    expect(costSchema.parse(c)).toMatchObject({ amount: 92.5 });
  });

  it('requires item and amount', () => {
    expect(() => costSchema.parse({ id: 'c-x', date: '2024-07-02' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- schema`
Expected: FAIL — `costSchema` not exported.

- [ ] **Step 3: Write minimal implementation (append to `schema.ts`)**

Add to `src/data/schema.ts`:
```ts
export const costSchema = z.object({
  id: z.string().regex(/^c-/),
  date: z.string(),
  category: z.string().optional(),
  item: z.string(),
  amount: z.number(), // MONETARY — see monetary.ts
  vendorId: z.string().optional(),
  maintId: z.string().optional(),
});
export type Cost = z.infer<typeof costSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/schema.ts test/data/schema.test.ts
git commit -m "feat(data): cost schema"
```

---

### Task 7: Vendor schema

**Files:**
- Modify: `src/data/schema.ts`
- Test: `test/data/schema.test.ts`

- [ ] **Step 1: Write the failing test (append)**

Add to `test/data/schema.test.ts`:
```ts
import { vendorSchema } from '../../src/data/schema.js';

describe('vendorSchema', () => {
  it('accepts a vendor with services', () => {
    const v = { id: 'v-sailloft', name: 'The Sail Loft', phone: '555-0100', services: ['rigging', 'sails'] };
    expect(vendorSchema.parse(v)).toMatchObject({ name: 'The Sail Loft' });
  });

  it('requires id and name', () => {
    expect(() => vendorSchema.parse({ id: 'v-x' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- schema`
Expected: FAIL — `vendorSchema` not exported.

- [ ] **Step 3: Write minimal implementation (append to `schema.ts`)**

Add to `src/data/schema.ts`:
```ts
export const vendorSchema = z.object({
  id: z.string().regex(/^v-/),
  name: z.string(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  url: z.string().optional(),
  services: z.array(z.string()).optional(),
});
export type Vendor = z.infer<typeof vendorSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/schema.ts test/data/schema.test.ts
git commit -m "feat(data): vendor schema"
```

---

### Task 8: Inventory schema

**Files:**
- Modify: `src/data/schema.ts`
- Test: `test/data/schema.test.ts`

Inventory tracking dates are stored as **explicit next-due ISO dates**: `inspect`
= next inspection due, `service` = next service due, `expires` = expiry date.
Derived tasks (Task 12) compare these to "today".

- [ ] **Step 1: Write the failing test (append)**

Add to `test/data/schema.test.ts`:
```ts
import { inventorySchema } from '../../src/data/schema.js';

describe('inventorySchema', () => {
  it('accepts an inventory item with tracking dates', () => {
    const inv = { id: 'inv-flares', name: 'Handheld flares', category: 'Safety', count: 6, expires: '2025-08-01', condition: 'good' };
    expect(inventorySchema.parse(inv)).toMatchObject({ id: 'inv-flares' });
  });

  it('accepts a partial item (id + name only)', () => {
    expect(() => inventorySchema.parse({ id: 'inv-x', name: 'Spare shackles' })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- schema`
Expected: FAIL — `inventorySchema` not exported.

- [ ] **Step 3: Write minimal implementation (append to `schema.ts`)**

Add to `src/data/schema.ts`:
```ts
export const inventorySchema = z.object({
  id: z.string().regex(/^inv-/),
  name: z.string(),
  category: z.string().optional(),
  location: z.string().optional(),
  count: z.number().optional(),
  level: z.string().optional(),
  condition: z.string().optional(),
  inspect: z.string().optional(),  // next inspection due (ISO date)
  service: z.string().optional(),  // next service due (ISO date)
  expires: z.string().optional(),  // expiry date (ISO date)
  photos: z.array(z.string()).optional(),
});
export type Inventory = z.infer<typeof inventorySchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/schema.ts test/data/schema.test.ts
git commit -m "feat(data): inventory schema with tracking dates"
```

---

### Task 9: Manual / quickref / boat schemas + registry-consistency guard

**Files:**
- Modify: `src/data/schema.ts`, `src/data/monetary.ts`, `test/data/schema.test.ts`, `test/data/monetary.test.ts`

- [ ] **Step 1: Write the failing schema tests (append to `schema.test.ts`)**

Add to `test/data/schema.test.ts`:
```ts
import { manualSchema, quickrefSchema, boatSchema } from '../../src/data/schema.js';

describe('manual/quickref/boat schemas', () => {
  it('accepts a manual with sections and a file ref', () => {
    const man = { id: 'man-engine', title: 'Universal M-25 Manual', kind: 'engine', file: 'manuals/m25.pdf', sections: [{ title: 'Winterizing', anchor: 'winterize' }] };
    expect(manualSchema.parse(man)).toMatchObject({ id: 'man-engine' });
  });

  it('accepts a quickref list', () => {
    const qr = [{ id: 'qr-reef', title: 'Reefing the main', body: 'Ease the halyard…' }];
    expect(quickrefSchema.parse(qr)).toHaveLength(1);
  });

  it('accepts boat identity + welcome content', () => {
    const boat = { name: 'Valkyrie', make: 'Catalina', model: '25', year: 1985, welcome: { rules: ['Life jackets on deck'], whatToBring: ['Soft-soled shoes'] } };
    expect(boatSchema.parse(boat)).toMatchObject({ name: 'Valkyrie' });
  });
});
```

- [ ] **Step 2: Write the failing registry-consistency test (append to `monetary.test.ts`)**

Add to `test/data/monetary.test.ts`:
```ts
import { collectionSchemas } from '../../src/data/schema.js';

describe('monetary registry stays in sync with schemas', () => {
  it('every monetary field exists in its collection schema', () => {
    for (const [collection, fields] of Object.entries(MONETARY_FIELDS)) {
      const schema = collectionSchemas[collection as keyof typeof collectionSchemas];
      expect(schema, `no schema for ${collection}`).toBeDefined();
      const shapeKeys = Object.keys((schema as any).shape);
      for (const field of fields) {
        expect(shapeKeys, `${collection}.${field} missing from schema`).toContain(field);
      }
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- schema monetary`
Expected: FAIL — `manualSchema`, `quickrefSchema`, `boatSchema`, `collectionSchemas` not exported.

- [ ] **Step 4: Write minimal implementation (append to `schema.ts`)**

Add to `src/data/schema.ts`:
```ts
export const manualSchema = z.object({
  id: z.string().regex(/^man-/),
  title: z.string(),
  kind: z.string().optional(),
  file: z.string().optional(),
  sections: z.array(z.object({ title: z.string(), anchor: z.string().optional() })).optional(),
});
export type Manual = z.infer<typeof manualSchema>;

export const quickrefSchema = z.array(z.object({
  id: z.string().regex(/^qr-/),
  title: z.string(),
  body: z.string().optional(),
}));
export type Quickref = z.infer<typeof quickrefSchema>;

export const boatSchema = z.object({
  name: z.string(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().optional(),
  hailingPort: z.string().optional(),
  specs: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  welcome: z.object({
    rules: z.array(z.string()).optional(),
    whatToExpect: z.string().optional(),
    whatToBring: z.array(z.string()).optional(),
    safety: z.string().optional(),
  }).optional(),
});
export type Boat = z.infer<typeof boatSchema>;

/**
 * Per-collection record schemas, keyed by collection name (singular).
 * Excludes `quickref` (parsed as a whole array, not per-record) and `boat`
 * (a singleton config, not a record collection) — both are validated directly.
 */
export const collectionSchemas = {
  trip: tripSchema,
  maintenance: maintenanceSchema,
  cost: costSchema,
  vendor: vendorSchema,
  inventory: inventorySchema,
  manual: manualSchema,
} as const;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- schema monetary`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/schema.ts test/data/schema.test.ts test/data/monetary.test.ts
git commit -m "feat(data): manual/quickref/boat schemas + monetary-registry guard"
```

---

### Task 10: Demo dataset fixtures

**Files:**
- Create: `demo/boat.yaml`, `demo/quickref.yaml`, `demo/trips/t-2024-06-22.md`, `demo/maintenance/m-jib-halyard.md`, `demo/costs/c-jib-halyard.md`, `demo/vendors/v-sailloft.md`, `demo/inventory/inv-flares.md`, `demo/inventory/inv-fire-ext.md`, `demo/manuals/man-engine.md`

These fixtures are the smallest dataset that exercises every collection, a
cross-link chain (trip → maintenance → vendor + cost), and both inventory task
kinds (an expired item and a soon-due item).

- [ ] **Step 1: Create `demo/boat.yaml`**
```yaml
name: Valkyrie
make: Catalina
model: "25"
year: 1985
hailingPort: Gull Point
specs:
  loa: "25 ft"
  draft: "4 ft (fin keel)"
welcome:
  rules:
    - Life jackets on deck under way.
    - No bananas aboard. (Skipper's rule.)
  whatToExpect: A relaxed day sail on a classic Catalina 25.
  whatToBring:
    - Soft-soled shoes
    - Sun protection
    - A layer for the afternoon breeze
  safety: PFDs are under the V-berth. Fire extinguisher by the companionway.
```

- [ ] **Step 2: Create `demo/quickref.yaml`**
```yaml
- id: qr-reef
  title: Reefing the main
  body: Head up, ease the halyard to the reef mark, hook the tack, winch the clew, re-tension.
- id: qr-anchor
  title: Setting the anchor
  body: Motor to spot, lower scope 5:1, back down gently to set, take a transit.
```

- [ ] **Step 3: Create `demo/trips/t-2024-06-22.md`**
```markdown
---
id: t-2024-06-22
title: Shakedown to Gull Point
date: 2024-06-22
durationHrs: 5.5
distanceNm: 11.4
engineHrs: 1.2
sky: Sunny, high cirrus
wind: SW 10-14 kt
crew: [Skipper, Dana R.]
waypoints:
  - { name: Mariner's Cove Marina, type: depart, time: "10:15", note: "Motored out of the fairway." }
  - { name: Gull Point anchorage, type: anchor, time: "12:20", note: "Anchored in 9 ft." }
findings:
  - { text: "Jib halyard frayed below the shackle.", severity: high, maintId: m-jib-halyard }
photos: []
---

First proper sail of the season. She handled the building afternoon breeze
beautifully on a reach.
```

- [ ] **Step 4: Create `demo/maintenance/m-jib-halyard.md`**
```markdown
---
id: m-jib-halyard
title: Replace frayed jib halyard
system: Rigging
status: done
priority: 1
opened: 2024-06-22
due: 2024-06-30
completed: 2024-07-02
costEst: 95
vendorId: v-sailloft
fromTripId: t-2024-06-22
photos: []
---

Several broken strands just below the shackle splice.

## Steps
- [x] Measure old halyard end-to-end (~60 ft).
- [x] Feed new line; re-splice the shackle.
```

- [ ] **Step 5: Create `demo/costs/c-jib-halyard.md`**
```markdown
---
id: c-jib-halyard
date: 2024-07-02
category: Rigging
item: New jib halyard line + shackle splice
amount: 92.5
vendorId: v-sailloft
maintId: m-jib-halyard
---
```

- [ ] **Step 6: Create `demo/vendors/v-sailloft.md`**
```markdown
---
id: v-sailloft
name: The Sail Loft
phone: "555-0100"
email: rigging@sailloft.example
services: [rigging, sails, splicing]
---

Quick turnaround on running rigging. Ask for Marco.
```

- [ ] **Step 7: Create `demo/inventory/inv-flares.md`** (expired — drives an overdue task)
```markdown
---
id: inv-flares
name: Handheld flares
category: Safety
count: 6
expires: 2024-05-01
condition: good
---

Stored in the orange ditch bag.
```

- [ ] **Step 8: Create `demo/inventory/inv-fire-ext.md`** (inspection due soon — drives a due task)
```markdown
---
id: inv-fire-ext
name: Fire extinguisher (companionway)
category: Safety
count: 1
inspect: 2024-07-10
condition: charged
---

Mounted by the companionway steps.
```

- [ ] **Step 9: Create `demo/manuals/man-engine.md`**
```markdown
---
id: man-engine
title: Universal M-25 Owner's Manual
kind: engine
file: manuals/universal-m25.pdf
sections:
  - { title: Winterizing, anchor: winterize }
  - { title: Fuel system, anchor: fuel }
---

Reference manual for the Universal M-25 diesel.
```

- [ ] **Step 10: Commit**

```bash
git add demo/
git commit -m "test(data): demo Valkyrie dataset fixtures"
```

---

### Task 11: Dataset loader

**Files:**
- Create: `src/data/dataset.ts`
- Test: `test/data/dataset.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/data/dataset.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDataset } from '../../src/data/dataset.js';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');

describe('loadDataset', () => {
  it('loads every collection from the demo dataset', async () => {
    const ds = await loadDataset(DEMO);
    expect(ds.boat.name).toBe('Valkyrie');
    expect(ds.trips.map((t) => t.id)).toContain('t-2024-06-22');
    expect(ds.maintenance.map((m) => m.id)).toContain('m-jib-halyard');
    expect(ds.costs.map((c) => c.id)).toContain('c-jib-halyard');
    expect(ds.vendors.map((v) => v.id)).toContain('v-sailloft');
    expect(ds.inventory).toHaveLength(2);
    expect(ds.manuals.map((m) => m.id)).toContain('man-engine');
    expect(ds.quickref.map((q) => q.id)).toContain('qr-reef');
  });

  it('attaches the body narrative to records', async () => {
    const ds = await loadDataset(DEMO);
    const trip = ds.trips.find((t) => t.id === 't-2024-06-22')!;
    expect(trip.body).toContain('First proper sail');
  });

  it('throws a descriptive error on a schema-invalid record', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-'));
    mkdirSync(join(dir, 'trips'), { recursive: true });
    writeFileSync(join(dir, 'boat.yaml'), 'name: Test\n');
    writeFileSync(join(dir, 'trips', 't-bad.md'), '---\nid: t-bad\n---\nno date here\n');
    await expect(loadDataset(dir)).rejects.toThrow(/t-bad/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dataset`
Expected: FAIL — cannot resolve `dataset.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/dataset.ts`:
```ts
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { parseRecord } from './record.js';
import {
  boatSchema, tripSchema, maintenanceSchema, costSchema, vendorSchema,
  inventorySchema, manualSchema, quickrefSchema,
  type Boat, type Trip, type Maintenance, type Cost, type Vendor,
  type Inventory, type Manual, type Quickref,
} from './schema.js';

/** A record plus its Markdown body narrative. */
export type WithBody<T> = T & { body: string };

export interface Dataset {
  boat: Boat;
  trips: WithBody<Trip>[];
  maintenance: WithBody<Maintenance>[];
  costs: WithBody<Cost>[];
  vendors: WithBody<Vendor>[];
  inventory: WithBody<Inventory>[];
  manuals: WithBody<Manual>[];
  quickref: Quickref;
}

async function loadCollection<T>(dir: string, sub: string, schema: z.ZodType<T>): Promise<WithBody<T>[]> {
  let files: string[];
  try {
    files = (await readdir(join(dir, sub))).filter((f) => f.endsWith('.md'));
  } catch (err) {
    // A missing collection directory is fine (returns []); anything else
    // (permissions, not-a-directory, etc.) is a real error — rethrow it.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return [];
  }
  const out: WithBody<T>[] = [];
  for (const file of files.sort()) {
    const raw = await readFile(join(dir, sub, file), 'utf8');
    const { data, body } = parseRecord(raw);
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`Invalid record ${sub}/${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    }
    out.push({ ...(parsed.data as T), body });
  }
  return out;
}

export async function loadDataset(dir: string): Promise<Dataset> {
  const boatRaw = parseYaml(await readFile(join(dir, 'boat.yaml'), 'utf8'));
  const boat = boatSchema.parse(boatRaw);

  let quickref: Quickref = [];
  try {
    quickref = quickrefSchema.parse(parseYaml(await readFile(join(dir, 'quickref.yaml'), 'utf8')));
  } catch (err) {
    // quickref.yaml is optional: a MISSING file is fine, but a present-but-broken
    // file (bad YAML or schema-invalid) is a real error — rethrow it.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  return {
    boat,
    trips: await loadCollection(dir, 'trips', tripSchema),
    maintenance: await loadCollection(dir, 'maintenance', maintenanceSchema),
    costs: await loadCollection(dir, 'costs', costSchema),
    vendors: await loadCollection(dir, 'vendors', vendorSchema),
    inventory: await loadCollection(dir, 'inventory', inventorySchema),
    manuals: await loadCollection(dir, 'manuals', manualSchema),
    quickref,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dataset`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/dataset.ts test/data/dataset.test.ts
git commit -m "feat(data): dataset loader with schema validation"
```

---

### Task 12: Cross-link integrity

**Files:**
- Create: `src/data/links.ts`
- Test: `test/data/links.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/data/links.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- links`
Expected: FAIL — cannot resolve `links.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/links.ts`:
```ts
import type { Dataset } from './dataset.js';

export interface BrokenLink {
  from: string;   // source record id
  field: string;  // which reference field
  target: string; // the missing target id
}

export function checkLinkIntegrity(ds: Dataset): BrokenLink[] {
  const has = {
    trip: new Set(ds.trips.map((t) => t.id)),
    maintenance: new Set(ds.maintenance.map((m) => m.id)),
    vendor: new Set(ds.vendors.map((v) => v.id)),
  };
  const broken: BrokenLink[] = [];
  const check = (cond: boolean, from: string, field: string, target: string) => {
    if (!cond) broken.push({ from, field, target });
  };

  for (const t of ds.trips) {
    for (const f of t.findings ?? []) {
      if (f.maintId) check(has.maintenance.has(f.maintId), t.id, 'findings.maintId', f.maintId);
    }
  }
  for (const m of ds.maintenance) {
    if (m.vendorId) check(has.vendor.has(m.vendorId), m.id, 'vendorId', m.vendorId);
    if (m.fromTripId) check(has.trip.has(m.fromTripId), m.id, 'fromTripId', m.fromTripId);
  }
  for (const c of ds.costs) {
    if (c.vendorId) check(has.vendor.has(c.vendorId), c.id, 'vendorId', c.vendorId);
    if (c.maintId) check(has.maintenance.has(c.maintId), c.id, 'maintId', c.maintId);
  }
  return broken;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- links`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/links.ts test/data/links.test.ts
git commit -m "feat(data): cross-link integrity check"
```

---

### Task 13: Derived views — inventory tasks + attention rollup

**Files:**
- Create: `src/data/derive.ts`
- Test: `test/data/derive.test.ts`

The clock is injected (`now: Date`) so behavior is deterministic. `DUE_WINDOW_DAYS
= 30`: a tracking date in the past → `overdue`; within the next 30 days → `due`;
further out → no task.

- [ ] **Step 1: Write the failing test**

Create `test/data/derive.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- derive`
Expected: FAIL — cannot resolve `derive.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/derive.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- derive`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/derive.ts test/data/derive.test.ts
git commit -m "feat(data): derived inventory tasks + attention rollup"
```

---

### Task 14: Search across collections

**Files:**
- Create: `src/data/search.ts`
- Test: `test/data/search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/data/search.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- search`
Expected: FAIL — cannot resolve `search.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/search.ts`:
```ts
import type { Dataset } from './dataset.js';

export interface SearchHit {
  collection: 'trip' | 'maintenance' | 'cost' | 'vendor' | 'inventory' | 'manual';
  id: string;
  title: string;
}

/**
 * Flatten a record's VALUES (not its field names) into one lowercased haystack.
 * Dropping top-level keys means a query like "id"/"vendorid" doesn't match every
 * record by field name. (Nested-object keys are still included via JSON.stringify.)
 */
function haystack(record: Record<string, unknown>): string {
  return Object.values(record)
    .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')))
    .join(' ')
    .toLowerCase();
}

export function search(ds: Dataset, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const scan = (
    collection: SearchHit['collection'],
    records: Array<Record<string, unknown> & { id: string }>,
    titleOf: (r: any) => string,
  ) => {
    for (const r of records) {
      if (haystack(r).includes(q)) hits.push({ collection, id: r.id, title: titleOf(r) });
    }
  };
  scan('trip', ds.trips, (r) => r.title ?? r.id);
  scan('maintenance', ds.maintenance, (r) => r.title);
  scan('cost', ds.costs, (r) => r.item);
  scan('vendor', ds.vendors, (r) => r.name);
  scan('inventory', ds.inventory, (r) => r.name);
  scan('manual', ds.manuals, (r) => r.title);
  return hits;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- search`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/search.ts test/data/search.test.ts
git commit -m "feat(data): cross-collection search"
```

---

### Task 15: Public barrel export + docs refresh + full green run

**Files:**
- Create: `src/data/index.ts`
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Create the barrel export**

Create `src/data/index.ts`:
```ts
export * from './record.js';
export * from './schema.js';
export * from './monetary.js';
export * from './dataset.js';
export * from './links.js';
export * from './derive.js';
export * from './search.js';
```

- [ ] **Step 2: Update `README.md` "Layout" section**

In `README.md`, replace the `src/data/` bullet under "Layout" with:
```markdown
- `src/data/` — the data layer: `record` (frontmatter parse/serialize), `schema`
  (Zod schemas + types), `monetary` (cost-field registry), `dataset` (load a data
  dir), `links` (cross-link integrity), `derive` (inventory tasks + attention),
  `search`. Public API is `src/data/index.ts`.
```

- [ ] **Step 3: Update `CLAUDE.md` with the data-layer note**

Append to `CLAUDE.md` under "Stack & layout":
```markdown
- Data layer modules: `record`, `schema`, `monetary`, `dataset`, `links`,
  `derive`, `search`. The `derive` functions take an injected `now: Date` for
  deterministic tests — never call `new Date()` inside them. Record IDs follow the
  prototype: `t-YYYY-MM-DD`, `m-<slug>`, `c-<slug>`, `v-<slug>`, `inv-<slug>`,
  `man-<slug>`, `qr-<slug>`.
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: ALL tests PASS; `tsc --noEmit` reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/data/index.ts README.md CLAUDE.md
git commit -m "feat(data): barrel export; refresh README + CLAUDE.md for the data layer"
```

---

## Self-Review

**Spec coverage (P1a slice of the "Data layer" component):**
- Parse/serialize Markdown+frontmatter ↔ records → Task 2 ✓
- Schema validation (valid / partial-but-valid / invalid) for every collection → Tasks 4–9 ✓
- Monetary-field tagging (the redaction source of truth for P1b) → Tasks 3, 9 ✓
- Load a data dir into a typed in-memory dataset → Task 11 ✓
- Cross-link resolution / integrity → Task 12 ✓
- Derived inventory tasks + overdue/attention rollup against a fixed clock → Task 13 ✓
- Search across all collections → Task 14 ✓
- Demo (Valkyrie) seed dataset → Task 10 ✓
- README + CLAUDE.md created early and kept updated → Tasks 1, 15 ✓

**Deferred to later plans (out of scope for P1a, by design):** photo compression
(P1b), git commit/pull/push + sync (P1b/P2), the REST API + auth + server-side
cost redaction (P1b — it consumes `monetary.ts` from this plan), the SPA (P1c).
"Today = real current date" is satisfied by injecting `now` here; callers in P1b
pass the real clock.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test
step shows the assertions.

**Type consistency:** `parseRecord`/`serializeRecord`, `loadDataset`/`Dataset`/
`WithBody`, `collectionSchemas`, `MONETARY_FIELDS`/`OWNER_ONLY_COLLECTIONS`/
`isMonetaryField`, `checkLinkIntegrity`/`BrokenLink`, `deriveInventoryTasks`/
`deriveAttention`/`InventoryTask`/`DUE_WINDOW_DAYS`, `search`/`SearchHit` are used
consistently across tasks and re-exported in Task 15. Collection keys are singular
(`trip`, `maintenance`, `cost`, `vendor`, `inventory`, `manual`) everywhere.
