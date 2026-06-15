# Ship's Log — a reusable, git-backed boat management hub — Design

**Date:** 2026-06-14
**Status:** Approved (design phase)
**Author:** Joe McCormick (with Claude)

## Goal

Turn the "Valkyrie · Ship's Log" Claude Design prototype into a **reusable,
self-hostable boat management hub** — fork it, point it at your own boat, and go.

It must satisfy three things at once:

1. **A polished, editable web app** for ~90% of use: open it on a phone or
   desktop and fill in what happened (trips, maintenance, inventory, costs,
   vendors). Partial entries are first-class — a trip that is *just free text*
   with no structured fields is valid.
2. **Cowork-enabled** for the other ~10%: clone the data repo, drop in photos you
   took, and have Claude Cowork read a half-written entry, look at the images,
   research the fix (web + the boat's own manuals), flesh out the trip narrative,
   and open the linked maintenance item — then push it back. **No AI runs inside
   the app itself.**
3. **Deployed to a secure VPS** behind Pangolin with no exposed ports, mirroring
   the existing DA-RAG deployment pattern.

The source of truth is **git**. Git is also the **two-way sync bus** between the
VPS app and Cowork.

## Background — the prototype

The handoff bundle (`catalina-sailboat-management-hub`) is a client-side React
prototype (UMD React + in-browser Babel) with **all data hardcoded in
`window.DATA`** and explicitly "no real saving." It has eight pages — Welcome,
Search, Trip logs, Maintenance, Inventory, Costs, Manuals, Vendors — with rich
cross-links: a trip *finding* references a maintenance item; a maintenance item
references its originating trip, a vendor, and a cost; inventory items carry
inspection/service/expiry tracking that derives "overdue/due" tasks
(`window.invTasks()`), which feed the Maintenance nav badge.

Everything except "it's a Catalina 25" is placeholder. The prototype's value is
its **design and its data relationships**, not its content.

## Key decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Source of truth | **Git repo, data as files** | Cowork works natively on a clone; forkable; versioned logbook; no DB to run or back up. Scale is tiny (one boat). |
| Photos | **Compressed, in the repo** | Resize on upload (~200–500 KB). Fits a repo for years at a personal boat's pace; Cowork sees images in the clone with zero extra setup. Documented escape hatch to object storage. |
| Boats per instance | **One boat per instance** | Matches "fork it for your boat." Boat identity is editable config; sample data is a wipeable seed. |
| Repo layout | **Two repos** | `ship-log` (public app/template) + `<boat>-log` (private data). App updates never collide with data history; data stays private; Cowork only touches the data repo. |
| Stack | **TypeScript end-to-end** | Vite + React SPA + thin Node server. Frontend-dominant app, thin backend, one language → low fork barrier. Deployment pattern is language-agnostic. |
| Data format | **One file per record, Markdown + YAML frontmatter** | Structured fields in frontmatter, narrative in the body — fits "type free text, leave fields blank, let Cowork finish." Human-diffable; conflict-resistant. |
| App AI | **None in the app** | All AI is Cowork, operating externally on the data repo via git. |
| Auth | **Pangolin SSO for the browser UI** | No machine/API surface (Cowork goes through GitHub), so no app-layer API key needed — simpler than DA-RAG. |

## Scope

**In scope**

- A reusable web app that recreates the prototype's eight pages faithfully, with
  all boat-specific content sourced from data, not hardcoded.
- Full create/edit for trips, maintenance, inventory, costs, vendors; partial
  entries supported.
- A git-backed data layer: read/parse, write/serialize, commit, pull, push.
- A photo pipeline: upload → compress → store in repo → reference from records.
- Derived views: inventory-task computation, overdue/due rollups, search.
- Two-way sync between the VPS app and Cowork via git (timed pull + commit/push
  on save), with safe conflict handling.
- VPS deployment: Docker, no exposed ports, Pangolin network, SSO.
- A `data-template` scaffold and a `demo` (Valkyrie) dataset for first-run/demo.
- `AGENTS.md` + schema docs in the data repo so Cowork knows the conventions.
- A Cowork skill packaging the "complete this trip log" workflow (Phase 3).

**Out of scope (YAGNI)**

- Multi-boat / fleet management, multi-tenant, public sharing beyond Pangolin SSO.
- Any AI/LLM inside the app; any MCP server in the app.
- A real database, object storage (documented as an escape hatch only), or Git LFS
  for the default path.
- Real-time collaborative editing / live multiplayer. Single user assumed.
- Mobile native apps. The web app is mobile-first and that is sufficient.

## Architecture

### Two repos

- **`ship-log`** (public, forkable) — the app: Vite + React SPA, the thin Node
  server, the Dockerfile + compose files, `data-template/` (empty scaffold), and
  `demo/` (the Valkyrie seed used when no data repo is configured).
- **`<boat>-log`** (private) — the data: `boat.yaml`, `trips/`, `maintenance/`,
  `inventory/`, `costs/`, `vendors/`, `manuals/`, `quickref.yaml`, `photos/`,
  plus `AGENTS.md` + `SCHEMA.md`. The VPS app clones this as its store; Cowork
  clones this to work.

### Components

| Unit | Responsibility | Depends on |
|---|---|---|
| **SPA (React)** | Render the eight pages from data; editing UI; partial-entry forms; photo upload UI; search; derived rollups. No boat-specific strings hardcoded. | REST API |
| **REST API (Node)** | `GET` collections/records; `POST`/`PUT` records (validated); photo upload; expose sync status. Single server-side writer (serialized via a write queue). | data layer, git layer, photo layer |
| **Data layer** | Parse Markdown+frontmatter ↔ typed records; serialize on write; validate against schema; resolve cross-links; compute derived tasks/rollups. | filesystem (working clone) |
| **Git layer** | Clone-on-boot / pull; stage+commit on write; `pull --rebase`; push; report conflict state. Never force-push, never clobber. | `simple-git`, working clone, credential |
| **Photo layer** | Compress uploads (`sharp`) to a size/dimension budget; write to `photos/`; return a repo-relative reference. | `sharp`, working clone |
| **Sync scheduler** | Timed `pull --rebase` (configurable); pull-on-load; surface conflict state to the UI. | git layer |
| **Config** | `DATA_REPO_URL`, git credential, `PULL_INTERVAL`, working-clone path, photo budget, demo-mode flag. | env / Docker secrets |

### Data flow

- **Read:** boot → ensure working clone (clone or pull) → data layer parses all
  records into memory (dataset is small) → API serves the SPA's reads → derived
  views (tasks, rollups, search index) computed in memory.
- **Write (app):** SPA `POST`/`PUT` → validate → data layer serializes file(s) →
  git layer `add`+`commit` → `pull --rebase` → `push`. Serialized through a write
  queue so the server is a single writer.
- **Write (Cowork):** Cowork pulls the data repo, edits files, adds photos,
  commits, pushes — standard git, no app involvement.
- **Converge:** sync scheduler pulls Cowork's pushes on a timer and on load; the
  in-memory dataset is refreshed after a successful pull.

### Data model & file format

One file per record, Markdown with YAML frontmatter. Structured fields live in
frontmatter; narrative lives in the body. Human-readable IDs from the prototype
are preserved (`t-YYYY-MM-DD`, `m-<slug>`, `v-<slug>`, `inv-<slug>`,
`man-<slug>`, `qr-<slug>`; costs get `c-<slug>`).

`boat.yaml` — identity, specs, and welcome-page content (rules, what-to-expect,
what-to-bring, safety). The single place a forker edits to make the app theirs.

Representative `trips/t-2024-06-22.md`:

```markdown
---
id: t-2024-06-22
title: Shakedown to Gull Point
date: 2024-06-22
durationHrs: 5.5
distanceNm: 11.4
engineHrs: 1.2
sky: Sunny, high cirrus
wind: SW 10–14 kt
seas: 1 ft chop
tempF: 74
crew: [Skipper, Dana R., Marco P.]
waypoints:
  - { name: Mariner's Cove Marina, type: depart, time: "10:15", note: "Motored out…" }
  - { name: Gull Point anchorage, type: anchor, time: "12:20", note: "Anchored in 9 ft…" }
findings:
  - { text: "Jib halyard frayed below the shackle.", severity: high, maintId: m-jib-halyard }
photos: [photos/t-2024-06-22-01.jpg]
---

First proper sail of the season. She handled the building afternoon breeze
beautifully on a reach… (free-form narrative; this may be the *only* content a
partial entry has).
```

Representative `maintenance/m-jib-halyard.md`:

```markdown
---
id: m-jib-halyard
title: Replace frayed jib halyard
system: Rigging
status: overdue        # overdue | due | scheduled | done
priority: 1
opened: 2024-06-22
due: 2024-06-30
completed: null
costEst: 95
vendorId: v-sailloft
fromTripId: t-2024-06-22
photos: [photos/m-jib-halyard-01.jpg]
---

Several broken strands just below the shackle splice. Do not sail on it again.

## Steps
- [ ] Measure old halyard end-to-end (~60 ft).
- [ ] Tape new line to old at the masthead sheave; feed through.
- [ ] Re-splice the shackle; whip the bitter end.
```

Other collections follow the same pattern: `inventory/` (tracking fields —
`inspect`/`service`/`expires`/`level`/`condition`/`count` — in frontmatter, note
in body), `vendors/` (contact + `services[]` in frontmatter, note in body),
`costs/` (pure structured frontmatter: date, category, item, amount, vendorId,
maintId), `manuals/` (metadata + `sections[]`; **may also hold the real manual
text/PDF** so Cowork can research against it), `quickref.yaml` (small how-tos).

**Derived logic to reimplement** (was in the prototype): inventory tasks
(overdue/due from inspect/service/expiry), the overdue rollup feeding the
Maintenance badge, and search across all collections. "Today" is the real current
date (the prototype hardcoded 2024-08-22).

### The app

- Recreate all eight pages **pixel-faithfully** from the prototype's HTML/CSS;
  recreate the visual output, not the prototype's in-browser-Babel structure.
- Every "Valkyrie"/boat string comes from `boat.yaml` or data.
- Editing: add/edit forms for each collection; **partial entries valid**
  (free-text-only trip, finding without a linked maintenance item yet, etc.).
- Photo upload: client sends the file; server compresses and stores; the record
  references it. Replaces the prototype's `photoCount` with real `photos[]`.
- Cross-link navigation preserved (finding → maintenance → vendor → cost → trip).

### Two-way sync

- The VPS app is the **single server-side writer**; writes are serialized.
- On save: write files → `commit` → `pull --rebase` → `push`. Commit author may be
  set from the Pangolin-authenticated user when available (optional, nice for
  multi-crew attribution); otherwise a generic app identity.
- Sync scheduler runs `pull --rebase` on an interval (`PULL_INTERVAL`, default
  ~5 min) and on load, refreshing the in-memory dataset on success.
- **Conflict handling:** one-file-per-record makes conflicts rare. On a rebase
  conflict, abort, enter a visible "sync conflict" state in the UI, and stop
  auto-push until resolved manually (via Cowork/CLI). Never force-push, never
  silently clobber.
- **Credential:** an SSH deploy key (read/write) mounted as a Docker secret, or a
  fine-grained PAT in env, scoped to the single data repo. Documented both ways.

### VPS deployment (mirror DA-RAG)

- Multi-stage Dockerfile (build SPA → run Node server).
- `docker-compose.yml` (base) + `docker-compose.vps.yml` (override): `ports:
  !override []` (nothing exposed), join the external `pangolin` network, pin a
  high IP (e.g. `172.18.0.22`) to avoid Gerbil's IPAM slot.
- Pangolin SSO protects the browser UI. No machine/API surface, so **no app-layer
  API key** (simpler than DA-RAG).
- The data-repo working clone lives in a named volume so it survives restarts.

### Reusability / onboarding

README walks a new owner through: fork `ship-log` → create a private repo from
`data-template/` → edit `boat.yaml` → set `DATA_REPO_URL` + deploy key → `docker
compose … up`. With no `DATA_REPO_URL`, the app runs in **demo mode** against the
bundled Valkyrie `demo/` dataset (read-only) for evaluation.

### Cowork enablement

- The data repo ships `AGENTS.md` (conventions, the file layout, the research
  workflow) and `SCHEMA.md` (record schemas, ID rules, cross-link rules) so Cowork
  writes consistent, schema-valid records.
- **Phase 3** adds a Cowork skill/slash-command packaging the target flow: *read
  the half-written trip + its photos → research the fix (web + `manuals/`) → write
  the trip narrative → open the linked maintenance item → commit & push.*

## Phasing

One spec; three implementation plans.

- **P1 — Core app + data layer (local).** SPA recreating the eight pages,
  parameterized to any boat; git-backed data layer (read/write/validate/commit);
  photo compression; derived views + search. Runs locally against `demo/` and a
  scratch data repo. Independently valuable and testable.
- **P2 — VPS deployment + two-way sync.** Dockerfile + compose (no ports, Pangolin
  network, pinned IP), SSO, the sync scheduler (timed pull), commit/push on save,
  conflict surfacing, credential handling, named volume.
- **P3 — Cowork enablement.** `AGENTS.md` + `SCHEMA.md` in the data template; a
  Cowork skill packaging the trip-completion + research workflow.

## Error handling

- **Write/serialize:** schema validation rejects bad records before any git op;
  the write queue prevents interleaved writes.
- **Git:** push failure → retry after `pull --rebase`; rebase conflict → "sync
  conflict" state, auto-push paused, surfaced in UI; missing/invalid credential →
  app boots read-only with a clear banner rather than crashing.
- **Photos:** reject oversized/unsupported uploads before compression; never write
  a record that references a photo that failed to store.
- **Demo mode:** with no data repo configured, all writes are disabled and the UI
  says so.

## Testing strategy

TDD; unit-first.

- **Data layer:** round-trip parse↔serialize for each record type; schema
  validation (valid, partial-but-valid, invalid); cross-link integrity; derived
  inventory-task and overdue-rollup logic against fixed clocks; search.
- **Photo layer:** compression hits the size/dimension budget; references resolve.
- **Git layer:** clone-on-boot, commit, `pull --rebase`, push against a temporary
  bare repo; conflict path enters the conflict state and does not push.
- **Sync:** simulate concurrent Cowork + app pushes → assert rebase/merge path and
  conflict surfacing.
- **App:** renders the eight pages from `demo/`; partial-entry create/edit;
  cross-link navigation; mobile layout.

## Risks / open questions

- **Git as a write store under two writers** — mitigated by single server writer +
  per-record files; conflict path is explicit and safe. Acceptable for one user.
- **Photo growth over years** — compression buys years; object storage / LFS is a
  documented escape hatch if a repo ever gets unwieldy.
- **Manual documents in-repo** — real owner's-manual text/PDF may be large; if so,
  manuals specifically can use the object-storage escape hatch. Decide per boat.
- **Pangolin SSO → commit author** — depends on a Pangolin-provided identity
  header; treat as optional polish, fall back to a generic app identity.
- **Exact Cowork skill packaging** — finalized in P3 once the data conventions are
  settled in P1.
