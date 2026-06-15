# Ship's Log — a reusable, git-backed boat management hub — Design

**Date:** 2026-06-14 (revised 2026-06-15 — auth model: app-level sessions + roles, replacing Pangolin SSO; added docs/conventions deliverables)
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
| Auth | **App-level auth: signed-cookie sessions + three roles (guest / crew / owner)** | Public Welcome page; everything else requires login. Crew see everything except costs; owners (multiple allowed) see costs + manage users. Cost redaction is **server-side**. Pangolin is tunnel-only (no SSO) so the app owns all authorization. The users store lives on the VPS, **never in the data repo**. |

## Roles & access model

Three roles. The **only** dividing line for *visibility* is cost data; the
dividing line for *write* is the crew's limited contribution scope.

| Role | Auth | Can see | Can write |
|---|---|---|---|
| **guest** | unauthenticated | Welcome page only (rules, what-to-expect, what-to-bring, safety) | nothing |
| **crew** | authenticated | Everything **except costs**: trips, maintenance, inventory, manuals, vendors, search — with **all monetary fields stripped server-side** | Create/edit **trip logs**; mark a **maintenance item complete** (status → `done`, completion date + optional note) |
| **owner** | authenticated (admin) | Everything, **including costs** and the Costs page | Full create/edit/delete across all collections; user management (add/remove users, set roles, reset passwords) |

- **Multiple owners are supported** (e.g., a spouse who wants to see monthly
  spend gets their own `owner` account). Owner is the admin tier.
- Crew taking the vessel out solo is the motivating crew use case: they log the
  trip and close out the maintenance they performed, but never see what anything
  cost.
- `role ∈ { owner, crew }` is stored per user; unauthenticated visitors are
  "guest" implicitly (no account).

## Scope

**In scope**

- A reusable web app that recreates the prototype's eight pages faithfully, with
  all boat-specific content sourced from data, not hardcoded.
- Full create/edit for trips, maintenance, inventory, costs, vendors; partial
  entries supported.
- **App-level authentication & authorization**: a public Welcome page; login for
  everything else; the three-role model above; **server-side redaction of all
  monetary fields** from crew responses (not a UI toggle); an owner-only **admin
  screen** for user management; **self-service password change** for any logged-in
  user; light login rate-limiting.
- A git-backed data layer: read/parse, write/serialize, commit, pull, push.
- A photo pipeline: upload → compress → store in repo → reference from records.
- Derived views: inventory-task computation, overdue/due rollups, search.
- Two-way sync between the VPS app and Cowork via git (timed pull + commit/push
  on save), with safe conflict handling.
- VPS deployment: Docker, no exposed ports, Pangolin network (tunnel-only, **no
  SSO**), session/owner secrets, a users-store volume.
- A `data-template` scaffold and a `demo` (Valkyrie) dataset for first-run/demo.
- `AGENTS.md` + schema docs in the data repo so Cowork knows the conventions.
- A Cowork skill packaging the "complete this trip log" workflow (Phase 3).
- **Project `README.md` and `CLAUDE.md`** (see "Project conventions & docs").

**Out of scope (YAGNI)**

- Multi-boat / fleet management, multi-tenant, public sharing beyond the public
  Welcome page.
- External identity providers / OAuth / Pangolin SSO; granular per-record ACLs or
  RBAC beyond the three fixed roles.
- Any AI/LLM inside the app; any MCP server in the app.
- A real database (the users store is a small hashed-credential file, not a DB),
  object storage (documented as an escape hatch only), or Git LFS for the default
  path.
- Real-time collaborative editing / live multiplayer.
- Mobile native apps. The web app is mobile-first and that is sufficient.

## Architecture

### Two repos

- **`ship-log`** (public, forkable) — the app: Vite + React SPA, the thin Node
  server, the Dockerfile + compose files, `data-template/` (empty scaffold), and
  `demo/` (the Valkyrie seed used when no data repo is configured).
- **`<boat>-log`** (private) — the data: `boat.yaml`, `trips/`, `maintenance/`,
  `inventory/`, `costs/`, `vendors/`, `manuals/`, `quickref.yaml`, `photos/`,
  plus `AGENTS.md` + `SCHEMA.md`. The VPS app clones this as its store; Cowork
  clones this to work. **The users store is NOT here** — it is deployment state.

### Components

| Unit | Responsibility | Depends on |
|---|---|---|
| **SPA (React)** | Render the pages from data; public Welcome page vs. gated app routing; login screen; role-aware nav (hide Costs + owner-only affordances for crew); admin screen (owner only); change-password UI; editing/partial-entry forms; crew write affordances (add trip, mark maintenance complete); photo upload UI; search; derived rollups. No boat-specific strings hardcoded. | REST API |
| **REST API (Node)** | `GET` collections/records; `POST`/`PUT` records (validated); photo upload; sync status. **Every request passes through auth + role authorization; monetary fields are redacted from non-owner responses.** Auth + admin endpoints. Single server-side writer (serialized via a write queue). | auth layer, data layer, git layer, photo layer |
| **Auth layer** | Verify credentials (argon2id hashing); issue/verify signed HTTP-only session cookies; enforce role per request; **strip monetary fields for non-owners**; gate owner-only endpoints (403); rate-limit login; owner bootstrap on first run. | users store, `SESSION_SECRET` |
| **Users store** | Hashed credential + role per user; CRUD by owners; self password-change. A small file (`users.json`) in a **VPS volume, outside the git data repo and the app repo**. | filesystem volume (not git) |
| **Data layer** | Parse Markdown+frontmatter ↔ typed records; serialize on write; validate against schema; resolve cross-links; compute derived tasks/rollups. | filesystem (working clone) |
| **Git layer** | Clone-on-boot / pull; stage+commit on write; `pull --rebase`; push; report conflict state. Never force-push, never clobber. | `simple-git`, working clone, credential |
| **Photo layer** | Compress uploads (`sharp`) to a size/dimension budget; write to `photos/`; return a repo-relative reference. | `sharp`, working clone |
| **Sync scheduler** | Timed `pull --rebase` (configurable); pull-on-load; surface conflict state to the UI. | git layer |
| **Config** | `DATA_REPO_URL`, git credential, `PULL_INTERVAL`, working-clone path, photo budget, demo-mode flag, `SESSION_SECRET`, owner-bootstrap (`OWNER_USERNAME`/`OWNER_PASSWORD`), users-store path. | env / Docker secrets |

### Data flow

- **Read:** boot → ensure working clone (clone or pull) → data layer parses all
  records into memory (dataset is small) → API serves the SPA's reads, **filtered
  by the requester's role (monetary fields stripped for non-owners; owner-only
  collections 403 for crew)** → derived views (tasks, rollups, search index)
  computed in memory.
- **Auth:** unauthenticated requests reach only the Welcome content and the login
  endpoint. Login → verify hash → set signed cookie. The SPA calls `/api/me` to
  learn its role and render the right nav. Logout clears the cookie.
- **Write (app):** SPA `POST`/`PUT` → **authorize against role + write scope**
  (crew limited to trip create/edit + maintenance-complete; owner unrestricted) →
  validate → data layer serializes file(s) → git layer `add`+`commit` (authored as
  the logged-in user) → `pull --rebase` → `push`. Serialized through a write queue
  so the server is a single writer.
- **Write (Cowork):** Cowork pulls the data repo, edits files, adds photos,
  commits, pushes — standard git, no app involvement.
- **Converge:** sync scheduler pulls Cowork's pushes on a timer and on load; the
  in-memory dataset is refreshed after a successful pull.

### Auth & authorization (detail)

- **Sessions:** stateless, signed **HTTP-only, Secure, SameSite cookie** (signed
  with `SESSION_SECRET`). No session store to run — fits the "no DB" ethos.
- **Passwords:** hashed with argon2id (bcrypt acceptable). Stored only in the
  users store; never logged, never committed to git.
- **Cost redaction (must be server-side):** a single **"monetary field" denylist**
  is applied in the serializer for every non-owner response. It covers the entire
  `costs/` collection (403 for crew), `costEst` and any monetary field on
  maintenance and other records, cost cross-links, the Costs entry in the nav
  payload, and any cost rows in the search index. A **golden test asserts no
  monetary key ever appears in a crew/guest payload** — hiding in the frontend is
  explicitly insufficient (it would leak in the JSON).
- **Owner bootstrap:** on first boot with an empty users store, seed one `owner`
  from `OWNER_USERNAME` / `OWNER_PASSWORD` (Docker secret / env). The owner changes
  it in-app afterward. If unset, the app boots but the gated area is inaccessible
  with a clear banner until an owner is seeded.
- **Admin screen (owner only):** list users; add user (username + temp password +
  role); set/reset password; change role; delete user.
- **Self-service:** any logged-in user can change their own password.
- **Login is internet-facing** (Pangolin tunnel, no SSO) → light rate-limiting on
  the login route; owners are urged to use a strong password.

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
costEst: 95            # MONETARY — redacted from non-owner responses
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
maintId — **owner-only collection**), `manuals/` (metadata + `sections[]`; **may
also hold the real manual text/PDF** so Cowork can research against it),
`quickref.yaml` (small how-tos).

**Monetary fields** (the redaction denylist) include at least: `costEst` on
maintenance, the entire `costs/` collection (`amount`, etc.), and any future
field tagged as monetary in the schema. The schema marks these explicitly so the
serializer's denylist stays correct as the model grows.

**Derived logic to reimplement** (was in the prototype): inventory tasks
(overdue/due from inspect/service/expiry), the overdue rollup feeding the
Maintenance badge, and search across all collections. "Today" is the real current
date (the prototype hardcoded 2024-08-22).

### The app

- Recreate all eight pages **pixel-faithfully** from the prototype's HTML/CSS;
  recreate the visual output, not the prototype's in-browser-Babel structure.
- Every "Valkyrie"/boat string comes from `boat.yaml` or data.
- **Public Welcome page** vs. **gated app**: the Welcome page renders for guests;
  a login affordance leads into the rest. Post-login, the nav is **role-aware**
  (Costs and owner-only actions hidden for crew; Admin shown only to owners).
- Editing: add/edit forms for each collection; **partial entries valid**
  (free-text-only trip, finding without a linked maintenance item yet, etc.).
  Crew write affordances are limited to **adding/editing trips** and **marking
  maintenance complete**; owners get full edit.
- Photo upload: client sends the file; server compresses and stores; the record
  references it. Replaces the prototype's `photoCount` with real `photos[]`.
- Cross-link navigation preserved (finding → maintenance → vendor → cost → trip),
  with the cost link absent for crew.

### Two-way sync

- The VPS app is the **single server-side writer**; writes are serialized.
- On save: write files → `commit` → `pull --rebase` → `push`. **Commit author is
  set from the logged-in app user** (real identity, nice for multi-crew
  attribution); falls back to a generic app identity if unavailable.
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
- **Pangolin is a plain tunnel (no SSO)** — the app is reachable publicly through
  it and gates itself. The no-exposed-ports security property is unchanged.
- Secrets/volumes: `SESSION_SECRET` and owner-bootstrap (`OWNER_USERNAME`/
  `OWNER_PASSWORD`) as Docker secrets/env; the **users store in a named volume,
  separate from the data working-clone volume**, so it survives restarts and never
  enters git. There is **no app-layer API key** (no machine/API surface; Cowork
  goes through GitHub).

### Reusability / onboarding

`README.md` walks a new owner through: fork `ship-log` → create a private repo
from `data-template/` → edit `boat.yaml` → set `DATA_REPO_URL` + deploy key →
set `SESSION_SECRET` + `OWNER_USERNAME`/`OWNER_PASSWORD` → `docker compose … up` →
log in as owner and add crew/owner accounts in the admin screen. With no
`DATA_REPO_URL`, the app runs in **demo mode**: it auto-presents a read-only view
over the bundled Valkyrie `demo/` dataset (clearly labeled DEMO) so the full UI —
including the Costs page with sample numbers — can be evaluated without auth.

### Cowork enablement

- The data repo ships `AGENTS.md` (conventions, the file layout, the research
  workflow) and `SCHEMA.md` (record schemas, ID rules, cross-link rules, the
  monetary-field tags) so Cowork writes consistent, schema-valid records.
- **Phase 3** adds a Cowork skill/slash-command packaging the target flow: *read
  the half-written trip + its photos → research the fix (web + `manuals/`) → write
  the trip narrative → open the linked maintenance item → commit & push.*

### Project conventions & docs

- **`README.md`** (app repo root) — the onboarding walkthrough above plus a brief
  architecture overview and local-dev instructions.
- **`CLAUDE.md`** (app repo root) — project rules and conventions, grown as we
  build (stack, layout, testing/TDD expectations, the role/redaction invariants,
  commit conventions).
- **Doc-upkeep convention:** `CLAUDE.md` carries the rule that **every change
  verifies `README.md` and `CLAUDE.md` are still accurate and updates them if
  not.** Enforced by convention (no hook), checked as part of finishing any change.

## Phasing

One spec; three implementation plans.

- **P1 — Core app + data layer + auth (local).** SPA recreating the eight pages,
  parameterized to any boat; git-backed data layer (read/write/validate/commit);
  photo compression; derived views + search; **app-level auth: sessions, the
  three-role model, server-side cost redaction, the admin screen, password
  change, owner bootstrap**. Runs locally against `demo/` and a scratch data repo.
  Also scaffolds `README.md` + `CLAUDE.md` early so conventions are tracked from
  the start. Independently valuable and testable.
- **P2 — VPS deployment + two-way sync.** Dockerfile + compose (no ports, Pangolin
  tunnel-only, pinned IP), session/owner secrets, the **users-store volume**, the
  sync scheduler (timed pull), commit/push on save (authored as the app user),
  conflict surfacing, credential handling, named volumes.
- **P3 — Cowork enablement.** `AGENTS.md` + `SCHEMA.md` in the data template; a
  Cowork skill packaging the trip-completion + research workflow.

## Error handling

- **Auth:** bad credentials → generic 401 (no user-enumeration); owner-only route
  hit by crew → 403; no owner seeded → gated area shows a clear "set up an owner"
  banner instead of crashing; repeated failed logins → rate-limited.
- **Write/serialize:** authorization rejects out-of-scope writes (e.g., crew
  editing costs) before validation; schema validation rejects bad records before
  any git op; the write queue prevents interleaved writes.
- **Git:** push failure → retry after `pull --rebase`; rebase conflict → "sync
  conflict" state, auto-push paused, surfaced in UI; missing/invalid credential →
  app boots read-only with a clear banner rather than crashing.
- **Photos:** reject oversized/unsupported uploads before compression; never write
  a record that references a photo that failed to store.
- **Demo mode:** with no data repo configured, all writes are disabled and the UI
  says so.

## Testing strategy

TDD; unit-first.

- **Auth & authorization:** login/logout/session round-trip; password hashing &
  change; per-endpoint role gating (403 for crew on owner-only routes); the
  **cost-redaction golden test** (no monetary key in any crew/guest payload, across
  every collection and search); crew write scope (trip create/edit + maintenance
  complete allowed; everything else rejected); admin user CRUD; owner bootstrap;
  demo-mode auto-view.
- **Data layer:** round-trip parse↔serialize for each record type; schema
  validation (valid, partial-but-valid, invalid); cross-link integrity; derived
  inventory-task and overdue-rollup logic against fixed clocks; search.
- **Photo layer:** compression hits the size/dimension budget; references resolve.
- **Git layer:** clone-on-boot, commit, `pull --rebase`, push against a temporary
  bare repo; conflict path enters the conflict state and does not push.
- **Sync:** simulate concurrent Cowork + app pushes → assert rebase/merge path and
  conflict surfacing.
- **App:** renders the pages from `demo/`; public Welcome vs. gated routing;
  role-aware nav; partial-entry create/edit; cross-link navigation; mobile layout.

## Risks / open questions

- **Git as a write store under two writers** — mitigated by single server writer +
  per-record files; conflict path is explicit and safe. Acceptable for one boat.
- **Photo growth over years** — compression buys years; object storage / LFS is a
  documented escape hatch if a repo ever gets unwieldy.
- **Manual documents in-repo** — real owner's-manual text/PDF may be large; if so,
  manuals specifically can use the object-storage escape hatch. Decide per boat.
- **Internet-facing login** (no SSO in front) — mitigated by argon2id, signed
  cookies, login rate-limiting, and strong owner passwords. Personal scale; no
  user-enumeration in error messages.
- **Users store is deployment state, not git** — it must be backed up separately
  (or be cheaply recreatable via owner bootstrap + re-adding crew). Documented in
  the README.
- **Cost-redaction completeness** — the denylist must stay in sync with the schema
  as monetary fields are added; the golden test and schema tagging are the guard.
- **Exact Cowork skill packaging** — finalized in P3 once the data conventions are
  settled in P1.
