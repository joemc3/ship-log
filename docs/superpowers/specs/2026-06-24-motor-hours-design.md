# Motor hours — lifetime engine hours + hour/calendar service reminders — Design

**Date:** 2026-06-24
**Status:** Approved (design phase)
**Author:** Joe McCormick (with Claude)

## Goal

Let the ship's log answer two questions about the engine:

1. **"How many hours are on the motor?"** — a running lifetime total, so we can
   reason about the engine's age and service history.
2. **"What engine service is due?"** — nag about recurring engine service (oil &
   filter, raw-water impeller, fuel filter, zincs…) when it comes due by **hours
   run *or* calendar time, whichever comes first** (engine oil degrades sitting
   in the crankcase even if the boat barely motors).

It must do this **without disturbing the maintenance collection** or any
cost/redaction logic, and stay genuinely small ("mini feature").

## Background — what already exists

- Each trip already carries an optional **`engineHrs`** field (hours the motor
  ran that outing). It is recorded on the trip form and shown as a chip on the
  trip detail, but **never totaled** — the Trips stats header rolls up distance
  and hours-afloat only.
- **Maintenance** items are one-shot, with a manual `status` enum
  (`overdue/due/scheduled/done`). There is **no recurring/interval mechanism**.
- The only derived "what's due" logic today is `deriveInventoryTasks` in
  `src/data/derive.ts`, which turns inventory `inspect`/`service`/`expires`
  **dates** into `overdue/due` tasks, and `deriveAttention`, which counts
  `maintenance (overdue|due)` + those inventory tasks for the nav badge. Both
  derive functions take an **injected `now: Date`** (deterministic tests; never
  argless `new Date()`).
- The engine is otherwise only a free-text spec string on `boat.yaml`
  (`specs.engine: "Universal M-25 diesel, 21 hp"`). There is **no engine-hours
  baseline** anywhere, and **no boat-config editor in the app** — `boat.yaml` is
  owner-curated in the data repo (by hand or via Cowork).

The per-trip primitive exists; what's missing is the lifetime rollup and a
recurring-service mechanism.

## Key decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **Running total + hour/calendar service reminders** | The "oil changes" goal needs something that flags *due*, not just a number. Generic non-engine meters (genset/watermaker) are explicitly out. |
| Per-trip capture | **Keep `engineHrs` (hours run) + a one-time baseline** | Matches what's already logged and how a casual skipper estimates motoring time; no change to the trip form. |
| Lifetime total | **`hoursStart` (baseline) + Σ `engineHrs`** | Trips already sum cleanly; the baseline anchors the total to the real meter when logging began. |
| Service trigger | **Hours OR calendar, whichever first** | Matches how engine manuals specify service (e.g. oil every 100 hrs *or* 12 months). |
| Where services live | **Self-contained `engine` block on `boat.yaml`** | One engine, a short fixed-ish service list — a config block, not a record collection. Leaves the maintenance model untouched (smallest, safest). |
| Service definition | **Curated in `boat.yaml` via the data repo** | Consistent with the existing "no boat editor in the app" pattern; avoids building the first in-app boat-config editor. |
| In-app interaction | **Display + a narrow "Log service" write (crew + owner)** | Mirrors `completeMaintenance`: a narrow op that re-arms a service and can never touch cost. |
| Sensitivity | **Non-monetary, all-access (within the read auth posture)** | Engine hours/intervals carry no cost data; `redaction-golden` is unaffected. |

## Data model

All new data lives on `boat.yaml`; the trip field is unchanged.

- **Per trip:** `engineHrs` (existing, optional `number`) — hours the motor ran
  that outing. **No change.**
- **New optional `engine` block on `boat.yaml`:**

  ```yaml
  engine:
    hoursStart: 412.0            # meter reading when the log began (baseline; optional, default 0)
    services:
      - id: oil                  # slug, unique within services
        label: Engine oil & filter
        everyHours: 100          # optional
        everyMonths: 12          # optional
        lastDoneHours: 380       # optional — engine hrs at last service
        lastDoneDate: 2025-08-01 # optional — ISO date of last service
      - id: impeller
        label: Raw-water impeller
        everyMonths: 24
        lastDoneDate: 2025-05-10
      - id: fuel-filter
        label: Primary fuel filter
        everyHours: 200
        lastDoneHours: 360
  ```

- **Lifetime hours = `hoursStart` + Σ `trip.engineHrs`** across all trips.
- **Nothing here is monetary.** `src/data/monetary.ts` is **not** touched; a
  service's *cost* still belongs in `costs/` / `maintenance.costEst` (out of
  scope here). **Never add a monetary field to the `engine` block.**

### Schema (`src/data/schema.ts`)

```ts
export const engineServiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  everyHours: z.number().positive().optional(),
  everyMonths: z.number().positive().optional(),
  lastDoneHours: z.number().nonnegative().optional(),
  lastDoneDate: isoDate.optional(),
});

export const engineSchema = z.object({
  hoursStart: z.number().nonnegative().optional(), // baseline; treated as 0 when absent
  services: z.array(engineServiceSchema).optional(),
});
```

`engine: engineSchema.optional()` is added to `boatSchema`. `tripSchema` is
unchanged. Service `id`s are assumed unique within `services`; a duplicate id is
a data error the owner avoids (we key the "Log service" write by id and act on
the first match — documented in `SCHEMA.md`).

## Derivation & triggers (`src/data/derive.ts`)

Three new **pure** functions, all honoring an injected `now: Date`:

- `deriveEngineHours(ds): number` → `(engine.hoursStart ?? 0) + Σ trip.engineHrs`.
- `deriveEngineServiceStatuses(ds, now): EngineServiceStatus[]` — the **full**
  per-service view (one entry per defined service, `status` including `'ok'`).
  This is the single source of truth the `GET /api/engine` route serves.
- `deriveEngineServiceTasks(ds, now): EngineServiceTask[]` — the **actionable
  subset** (`deriveEngineServiceStatuses(...)` filtered to `status !== 'ok'`),
  used only for the attention count.

For each service, both functions compute the per-trigger status and a combined
status the same way:

  - **Hours trigger** (only if `everyHours` set):
    `dueAtHours = (lastDoneHours ?? hoursStart ?? 0) + everyHours`;
    `hoursRemaining = dueAtHours − lifetime`. **Overdue** if `hoursRemaining < 0`;
    **due** if `0 ≤ hoursRemaining ≤ ENGINE_DUE_WINDOW_HOURS` (default **10 hrs**,
    a named constant alongside `DUE_WINDOW_DAYS`).
  - **Calendar trigger** (only if `everyMonths` **and** `lastDoneDate` set):
    `dueDate = addMonths(lastDoneDate, everyMonths)`, classified with the existing
    `classify(dueDate, now)` / `DUE_WINDOW_DAYS` (30). If `everyMonths` is set but
    there is no `lastDoneDate` to anchor from, the calendar trigger is **inactive**
    (returns no status) until the service is first logged.
  - The **combined status is the worse of the two** triggers (`overdue` beats
    `due` beats `ok`). A service is a **task** (surfaces in the attention count)
    when its combined status is `due` or `overdue`.

  Derived shapes (the card and route consume `EngineServiceStatus`; the attention
  count consumes `EngineServiceTask`, the same shape narrowed to actionable):

  ```ts
  interface EngineServiceStatus {
    id: string;
    label: string;
    status: 'ok' | 'due' | 'overdue';   // combined, worse-of-two
    hoursRemaining?: number;            // present iff everyHours set (negative = overdue by)
    dueDate?: string;                   // present iff calendar trigger active
    daysRemaining?: number;             // present iff calendar trigger active
  }
  // EngineServiceTask = EngineServiceStatus with status narrowed to 'due' | 'overdue'
  ```

- `deriveAttention(ds, now)` adds `deriveEngineServiceTasks(ds, now).length` so
  the **maintenance nav badge** includes engine services. The function and its
  tests are updated accordingly.

`addMonths` is a small local helper (UTC, ISO-date in/out) added to `derive.ts`;
month-end overflow is clamped (e.g. adding 1 month to Jan 31 yields the last day
of the next month, not a rolled-over date), and the result is an `isoDate`.

## API (`src/server/`)

- **`GET /api/engine`** (new, single responsibility) →

  ```jsonc
  {
    "hours": { "lifetime": 421.1, "hoursStart": 412.0 },
    "services": [
      { "id": "oil", "label": "Engine oil & filter",
        "everyHours": 100, "everyMonths": 12,
        "lastDoneHours": 380, "lastDoneDate": "2025-08-01",
        "status": "ok" | "due" | "overdue",
        "hoursRemaining": 58.9, "dueDate": "2026-08-01", "daysRemaining": 38 }
    ]
  }
  ```

  Returns the service **definitions** merged with their **derived** status/remaining,
  so the card needs a single fetch. **Auth posture = the standard reads**: open in
  demo, `requireAuth` otherwise (not owner-only — engine data is non-sensitive).
  Non-monetary, so the `redaction-golden` deep-walk passes untouched.

- **`POST /api/engine/services/:id/log`** (new write) → body
  `{ atHours?: number, on?: isoDate, note?: string }`. Defaults: `atHours` =
  current lifetime hours, `on` = today (from the server `now`). Effect: set that
  service's `lastDoneHours = atHours` and `lastDoneDate = on` in `boat.yaml` and
  **re-arm** it. `note` is accepted for parity/audit but, since `boat.yaml` has no
  per-service history list, is recorded only in the commit message (no new field).
  - **Permission: crew + owner** (a narrow op like `completeMaintenance`; can
    never touch cost), **`denyInDemo`**.
  - `404` for an unknown service id; `400` for a non-finite/negative `atHours` or
    a malformed `on` date.
  - Response is the updated `GET /api/engine` payload (re-derived).

- **`ShipStore.logEngineService(id, { atHours, on })`** — a new writer following
  the standard mutation path: `validate → write boat.yaml → commitPaths(['boat.yaml'],
  msg, author) → reload → atomic snapshot swap`. It stages **only** `boat.yaml`
  (never `git add .`), consistent with the precise-path commit rule. `atHours`
  defaulting to the current lifetime is computed inside the queued write from the
  fresh snapshot (so a concurrent trip write can't race the value).

## UI — an Engine card on the Maintenance page

The Maintenance page is the "work list," so the engine surface lives there.

- **`MaintenancePage.tsx`** gains an **Engine card** near the top:
  - A prominent **lifetime hours** figure with a `baseline + N since baseline`
    subtext.
  - One row per service: `label`, then **"X hrs left · due by DATE"** (or
    **"Overdue by X hrs"** / **"Overdue since DATE"**), with a status badge reusing
    the existing `overdue/due/scheduled` signal styling. A service with no active
    trigger reads as a calm "ok / not yet due."
  - A **"Log service"** button per row (**crew + owner, hidden in demo**) opens an
    inline panel (optional `atHours` prefilled to the current lifetime, optional
    `on` date defaulting today, optional `note`) → `POST /api/engine/services/:id/log`
    → on success, refresh (the page's existing `reloadKey` pattern). Mirrors the
    existing "Mark complete" affordance exactly.
- **`lib/api.ts`** gains `engine()` (GET) and `logEngineService(id, payload)`.
- **`lib/types.ts`** gains the engine types (`import type` from `schema.ts`) plus
  the small derived `EngineView`/`EngineServiceView` response shape.
- The card **degrades gracefully**: if `boat.yaml` has no `engine` block (or empty
  `services`), the card either hides or shows just the lifetime figure — never an
  error, never `$NaN`-style garbage.

*Optional, not built unless requested:* a lifetime-engine-hrs stat on the Trips
stats header. Noted here so it isn't forgotten; default is **not** to add it.

## Data & docs (same-change rule)

- **`demo/boat.yaml`:** add a realistic `engine` block for the *Valkyrie* M-25
  (a baseline plus oil / impeller / fuel-filter services with plausible
  `lastDone*`), so the demo shows the feature live, including at least one service
  that derives as `due`/`overdue` against the demo trips.
- **`data-template/boat.yaml`:** add a minimal placeholder `engine: { hoursStart:
  0, services: [] }` so the empty seed carries the shape (still schema-valid;
  `data-template.test.ts` stays green).
- **`SCHEMA.md` + `AGENTS.md`** (authored in `data-template/`, **byte-copied to
  `demo/`**): document the `engine` block fields, the lifetime-hours derivation,
  and the hours-or-calendar trigger rule; note `engineHrs` feeds the lifetime
  total and that the `engine` block carries **no** monetary data. Keeps the
  doc-drift / mirror tests green. (The doc-drift golden keys off collections /
  id-prefixes / monetary / cross-link / enums — none of which the `engine` block
  adds — so it won't fail on the new block, but the prose docs must still describe
  it and the demo/template copies must stay byte-identical.)

## Testing (TDD — failing test first)

- **Schema:** the `engine` block validates; rejects bad shapes (negative interval,
  non-ISO `lastDoneDate`, missing `id`/`label`).
- **Derive:** `deriveEngineHours` sums baseline + trip hours; `deriveEngineServiceTasks`
  covers hours-only, months-only, both-set, and missing-`lastDone*` cases, plus the
  worse-of-two combined status — all with a fixed injected `now`. `addMonths`
  month-end clamping. `deriveAttention` includes engine tasks.
- **Server:** `GET /api/engine` shape + auth posture (open in demo, 401 guest
  non-demo); `POST …/log` re-arms (updates `lastDoneHours`/`lastDoneDate`),
  defaults `atHours`/`on`, returns the re-derived payload, and yields `404` /
  `400` / crew-allowed / owner-allowed / `denyInDemo` as specified.
- **Store:** `logEngineService` writes `boat.yaml`, commits **only** `boat.yaml`
  (golden, like the existing precise-path tests), and reloads the snapshot.
- **UI:** the Engine card renders lifetime hours + per-service remaining; crew and
  owner see "Log service" (demo does not); a successful log refreshes; the card
  degrades when no `engine` block is present.
- **Unchanged guards stay green:** `redaction-golden` (engine is non-monetary),
  `p3-doc-drift-golden`, `cowork-docs-mirror`, `data-template`.

## Out of scope (YAGNI)

- Generic non-engine running meters (genset, watermaker, etc.).
- An in-app engine-schedule editor (baseline/intervals/service list are curated in
  `boat.yaml` via the data repo / Cowork).
- Routing engine-service **cost** through this feature (costs stay in `costs/` /
  `maintenance.costEst`).
- Per-service service **history** (only the latest `lastDone*` is stored; git
  history is the audit trail).

## Open questions

None blocking. Minor knobs with chosen defaults: `ENGINE_DUE_WINDOW_HOURS` = 10
(the "due soon" hours window), and whether to also show lifetime hrs on the Trips
header (default: no). Both are easily revisited during implementation.
