# Ship's Log — Conditions (weather + tides) — Design

**Date:** 2026-06-21
**Status:** Approved (design phase)
**Author:** Joe McCormick (with Claude)

## Goal

Add an all-access **Conditions** page showing, for where the boat currently/last
was:

1. **Current marine weather** — a forecast for the boat's area out to ~48 hours
   (wind/gust + direction, seas, temp, sky, precip), with an optional one-line
   summary.
2. **Tides** — the nearest tide station featured (next high/low + its full 48h
   hi/lo list), plus a curated set of ~10–12 stations spanning the surrounding
   rivers/ICW, each showing its next high & low. So at a glance: "high here at
   3:12, up the Wando at 3:48, up the Cooper at 4:05."

It must work two ways, the operator's choice:

- **Agentic (Joe's path):** a Hermes/Cowork agent keeps the data fresh on a cron
  the owner schedules, by editing a file in the data repo and pushing — exactly
  how the rest of the app's data is maintained. **The app itself makes no
  outbound calls.**
- **On-demand API (everyone else):** the server fetches live from free,
  keyless APIs (Open-Meteo for marine weather, NOAA CO-OPS for US tides), caches
  the result, and serves it.

Both paths sit behind **one endpoint and one page**; only the source of the
readings differs.

## Non-goals

- No second tide provider for non-US waters. NOAA CO-OPS is US-only; non-US
  forkers get global weather in API mode but must use agent mode for tides
  (documented limitation, see below).
- No in-app AI. The agentic path runs *outside* the app (a Cowork skill on a
  cron), edits the data repo, and pushes — the app pulls on its existing timer.
- No new location concept beyond what Conditions needs. We do **not** add
  coordinates to trip waypoints or derive position from trips. Position is set
  explicitly in the conditions config.
- No browser-side external calls. The strict CSP (`connect-src 'self'`) is
  preserved; all fetching is server-side.

## Background — why this shape

The existing system has no location/coordinate concept anywhere: `boat.yaml`
carries only a `hailingPort` string and trip waypoints have names but no lat/lon.
Conditions needs a real position, so it introduces one — scoped to itself.

The app's established discipline: data lives as files in the git data repo
(Markdown+frontmatter records; YAML singletons like `boat.yaml`/`quickref.yaml`),
the app is the single server-side writer for app-driven edits, Cowork edits files
in a clone and pushes, and the app pulls on a timer. The app never makes outbound
HTTP calls except the Purser assistant proxy. Conditions is designed to fit this
grain: the **agent** path is just another file Cowork maintains; the **API** path
is the one place we add server-side outbound fetches, deliberately gated and
cached.

## Architecture overview

**One file, one endpoint, two fillers.**

- A new singleton record file in the data repo — **`conditions.md`** — parsed
  with the existing `parseRecord` (frontmatter + optional Markdown body), loaded
  into the `Dataset` as `conditions: WithBody<Conditions> | null`.
- A new **public** route `GET /api/conditions` (no auth, same posture as
  `/api/welcome`) serves it.
- A `source: agent | api` flag in the file selects who fills the **readings**
  (the weather periods and tide predictions):
  - **`source: agent`** — the file already contains the readings; the server
    reads and serves them verbatim (plus a computed `stale` flag). No outbound
    calls.
  - **`source: api`** — the file contains only *config* (location + the curated
    station list); the server fetches live readings, merges them into the
    response, and caches them.

Same schema, same page, same endpoint — the only difference is whether readings
come from disk or a live fetch.

```
                         GET /api/conditions  (public)
                                   │
                    ┌──────────────┴───────────────┐
              source: agent                    source: api
                    │                                │
        read conditions.md                  read conditions.md (config only)
        readings come from file                      │
                    │                    src/server/conditions/service.ts
                    │                    ├─ weather.ts → Open-Meteo (Marine+Forecast)
                    │                    ├─ tides.ts   → NOAA CO-OPS (hilo predictions)
                    │                    └─ TTL cache + stale-on-error
                    └──────────────┬───────────────┘
                                   ▼
                   { source, location, weather?, tides?, body, asOf, stale, error? }
                                   ▼
                       ConditionsPage (pure API client)
```

## Data contract — `conditions.md`

A singleton (one-of-a-kind config, like `boat.yaml`/`quickref.yaml`), **not** a
collection: no id prefix, no cross-links, no monetary fields. Frontmatter is
structured; the Markdown body is an optional agent "conditions note" rendered via
the existing `Markdown.tsx`.

```markdown
---
source: agent                       # agent | api
location:
  label: "Charleston Harbor entrance"
  lat: 32.7765
  lon: -79.9311
  asOf: 2026-06-20T13:00:00Z        # when the position was last set
weather:                            # present in agent mode; server-filled in api mode
  asOf: 2026-06-20T13:05:00Z
  source: "NWS marine zone AMZ330"  # free-text provenance
  summary: "SW 10-15 kt, seas 2-3 ft, building Thu."
  periods:                          # ~48h horizon
    - { time: 2026-06-20T14:00:00Z, windDir: SW, windKt: 12, gustKt: 18, tempF: 84, seasFt: 2.5, sky: "Partly cloudy", precipPct: 10 }
    # …
tides:
  stations:                         # curated; first/primary = nearest the boat
    - { id: "8665530", name: "Charleston, Customs House Wharf", area: "Charleston Harbor", primary: true }
    - { id: "8665543", name: "Wando River, Causeway", area: "Wando R." }
    - { id: "8664753", name: "Cooper River, Filbin Creek", area: "Cooper R." }
    # … 10–12 total, spanning the rivers/ICW
  predictions:                      # present in agent mode; server-filled in api mode
    "8665530":
      - { type: H, time: 2026-06-20T15:12:00Z, heightFt: 5.8 }
      - { type: L, time: 2026-06-20T21:30:00Z, heightFt: 0.4 }
    # … keyed by station id
---

Light SW sea breeze fills in by early afternoon. A weak front Thursday backs the
wind NW and kicks up a short harbor chop — take your window before noon.
```

### Field rules

- `source` — `agent | api`. Required.
- `location` — `{ label, lat, lon, asOf? }`. Required. `label` is the
  human-readable area shown in the UI; `lat`/`lon` drive the API-mode weather
  fetch and (for context) display.
- `weather` — optional in the schema. In agent mode it is the rendered source of
  truth. In api mode the file omits `periods`/`asOf`/`summary` and the server
  fills them.
  - `weather.periods[]` — `{ time (ISO), windDir?, windKt?, gustKt?, tempF?,
    seasFt?, sky?, precipPct? }`. All but `time` optional, so sparse agent data
    and partial API normalization both validate.
- `tides` — optional in the schema.
  - `tides.stations[]` — `{ id, name, area?, primary? }`. The **curated** list;
    exactly one entry should carry `primary: true` (the nearest). `id` is a NOAA
    CO-OPS station id (used directly in API mode).
  - `tides.predictions` — a map of station id → `{ type: H|L, time (ISO),
    heightFt? }[]`. Present in agent mode; server-filled in api mode. 48h horizon.
- Markdown **body** — optional free-text note, rendered as Markdown.

**Access decision:** the page is **public** (guest-visible, like Welcome). The
operator accepts that this broadcasts the boat's general area; positions are set
intentionally in the file, so the operator controls precision (e.g. label a
marina rather than an exact anchor).

## Server layer

### Data layer (`src/data/`)

- `schema.ts` — add `conditionsSchema` (`location` required; `weather` and
  `tides.predictions` optional) and the `Conditions` type. Readings optional so
  api-mode (config-only) files validate.
- `dataset.ts` — `loadDataset` loads the `conditions.md` singleton via
  `parseRecord` into `Dataset.conditions: WithBody<Conditions> | null`. A
  **missing** file ⇒ `null` (feature simply not set up). A **present-but-invalid**
  file is a loud error (matches the loader's fail-loud rule).
- **No** `describe.ts` / `links.ts` / `monetary.ts` / `write.ts` changes — it is
  not a collection and carries nothing monetary or cross-linked. It is therefore
  **untouched by redaction** and does not perturb the redaction-golden or
  doc-drift invariants.

### Endpoint — `GET /api/conditions` (public)

- New `src/server/routes/conditions.ts`, registered with the data routes (before
  the `/api` JSON 404). **No auth** — same posture as `/api/welcome`.
- **agent mode:** return the file's frontmatter + body, plus a computed `stale`
  boolean so the UI can show "updated Nh ago / stale".
- **api mode:** delegate to `src/server/conditions/service.ts`, which returns the
  config merged with live readings.
- Response shape: `{ source, location, weather?, tides?, body, asOf?, stale,
  error? }`.
  - `asOf` (response-level) = the readings' freshness: `weather.asOf` in agent
    mode, the fetch timestamp in api mode. Drives the "updated Nh ago" line.
  - `stale` = `asOf` older than a freshness threshold (default **6 h**,
    injectable for tests), OR (api mode) the response is last-good after a failed
    refetch. A missing `asOf` is treated as stale.

### Fetch unit — `src/server/conditions/` (api mode only)

- `weather.ts` — Open-Meteo client. Marine API (wave height/period) + Forecast
  API (wind/gust/temp/precip/sky). **Free, no API key, global.** Normalizes to
  the schema's `periods[]` shape, ~48h.
- `tides.ts` — NOAA CO-OPS client (`api.tidesandcurrents.noaa.gov/.../datagetter`,
  `product=predictions`, `interval=hilo`, `datum=MLLW`, `units=english`,
  `time_zone=gmt`). **Free, no key.** One call per station id → `{ type, time,
  heightFt }[]` for 48h.
- `service.ts` — orchestrator + **in-memory TTL cache** (weather ~30 min, tides
  ~6 h; keyed by location + station set). On a fetch error: serve **last-good with
  `stale: true`**; with no prior good data, return config + `error: 'unavailable'`
  for the page to degrade on. Sends a polite `User-Agent`. **`fetch` and `now`
  are injected** (via `AppContext`/factory) so tests use fixtures with zero real
  network.

### Config & seams

- **`CONDITIONS_FETCH`** (optional, default true) — a kill-switch. When false, a
  hardened deployment forbids outbound fetches even if a file says `source: api`;
  the endpoint then returns config + `error: 'unavailable'`. Added to `config.ts`
  (not secret-bearing, so not in `SECRET_FILE_VARS`).
- **CSP untouched** — all fetching is server-side; `connect-src 'self'` preserved.
- **Demo mode** ships `demo/conditions.md` in **agent mode** (Charleston-flavored
  sample), so the demo page is alive with **no outbound calls** (demo never hits
  external APIs).
- **No other new required env.** The feature turns on by the file's presence; api
  mode is opt-in by `source: api`.

## UI layer

`src/ui/pages/ConditionsPage.tsx` + co-located `ConditionsPage.module.css`
(parchment tokens from `app.css`; the shared `app.css` is not edited).

- Sources **only** `GET /api/conditions`. Route `/conditions`, **public** (no
  guard). Nav item **"Conditions"** in the **Aboard** group (next to Welcome),
  shown to everyone, with a new wave/compass `Icon`.
- **Location header** — `label`, a relative "updated Nh ago" from `asOf`, and a
  **`stale` badge** when readings are old.
- **Weather strip** — horizontal 48h period cards (time, wind/gust + dir, seas,
  temp, sky, precip%); optional `weather.summary` as a lead line.
- **Tide board** — the **primary** station featured (next H/L prominent + its 48h
  hi/lo list), then the remaining stations as a compact list **grouped by
  `area`**, each showing its next high & low.
- **Optional agent prose** rendered with the existing `Markdown.tsx`.
- **Graceful degradation** — no weather ⇒ omit strip; no tides ⇒ omit board; no
  file ⇒ friendly "Conditions aren't set up yet" empty state (with a setup hint
  for owners); `error: 'unavailable'` ⇒ a clear notice, never a broken/`NaN`
  widget.

## Agent (Hermes) workflow

A new **`update-conditions`** Cowork skill, authored canonically under
`data-template/.claude/skills/update-conditions/SKILL.md` and **byte-copied** to
`demo/` (same canonical→demo mirror as the other Cowork docs). It:

1. Reads `conditions.md` for the location + curated station list.
2. Fetches weather + tides from whatever sources the operator prefers (NWS marine
   text, Open-Meteo, NOAA, etc. — agent mode is provider-agnostic and works
   worldwide).
3. Rewrites `conditions.md` frontmatter (readings + `asOf`) and optionally the
   prose note.
4. Commits & pushes.

`README.md`/`AGENTS.md` document **scheduling this on a cron** at the owner's
chosen interval. The app pulls the result on its existing sync timer — no app
change needed per refresh.

## Fixtures & docs

- `demo/conditions.md` — agent mode, Charleston sample (page alive without
  network).
- `data-template/conditions.md` — config-only starter with **both modes
  commented**; `data-template/examples/conditions.md` — the full shape, commented
  (loader never scans `examples/`).
- `AGENTS.md` + `SCHEMA.md` (canonical under `data-template/`, re-synced to
  `demo/`) gain a Conditions section: the file shape, the two modes, the curated
  station list, and the US-only tides limitation.
- `README.md` (config table: `CONDITIONS_FETCH`; the two modes; US-only tides
  note) and `CLAUDE.md` (a "Conditions" section) updated in the same change, per
  the project doc-upkeep rule.

## Testing (TDD throughout)

- **data** — `conditionsSchema` parse (agent-full + api-config-only); loader picks
  up `conditions.md`; absent ⇒ `null`; present-but-invalid ⇒ throws.
- **server** — route is public (guest 200); agent mode serves file readings +
  computes `stale`; api mode merges live readings from **injected-fetch fixtures**
  (Open-Meteo + NOAA); cache TTL asserted via fetch-call count; stale-on-error
  path; `CONDITIONS_FETCH=false` ⇒ degraded `error: 'unavailable'`. The
  **redaction-golden walk gains a conditions fixture** so the all-access surface is
  exercised and proven monetary-free.
- **ui** — renders weather cards + tide board (primary featured, stations grouped
  by `area`); stale badge; empty state; guest-visible.

## Implementation order (single plan)

Both modes ship in one pass (one plan), but the natural seam — useful for
ordering and incremental verification — is:

1. **Contract + agent path:** schema + loader + `Dataset.conditions`; route
   (agent mode + `stale`); `ConditionsPage` + nav + icon; `demo/conditions.md`;
   data tests + server route tests + ui tests.
2. **API path (additive):** `src/server/conditions/` (weather, tides, service +
   cache); wire api mode into the route; `CONDITIONS_FETCH`; injected-fetch
   server tests.
3. **Docs & fixtures:** `update-conditions` skill (template→demo mirror);
   `data-template/conditions.md` + example; `AGENTS.md`/`SCHEMA.md`/`README.md`/
   `CLAUDE.md`.

## Risks / open points

- **Open-Meteo "marine forecast" fidelity.** Open-Meteo gives clean global
  numeric data (wind/waves), not NWS marine-zone *text*. Acceptable for the API
  default; agent mode can use richer sources. If NWS marine text is later wanted
  in API mode, it's an additional provider behind the same `weather.periods`
  shape.
- **NOAA station ids must be valid.** A bad id yields an empty/failed station
  fetch; api mode degrades that station gracefully (no crash). Curating the list
  is the operator's/agent's responsibility; `SCHEMA.md` will point at the NOAA
  station lookup.
- **Free-API politeness.** TTL cache + `User-Agent` keep request volume low and
  well-behaved; the kill-switch is the hard stop.
