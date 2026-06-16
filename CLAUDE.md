# CLAUDE.md — Ship's Log conventions

Project rules and conventions. Grown as we build. See the design spec at
`docs/superpowers/specs/2026-06-14-ship-log-design.md`.

## Doc-upkeep rule (required)

Every change MUST verify that `README.md` and this `CLAUDE.md` are still accurate
and update them if not. Treat "are README.md and CLAUDE.md still correct?" as part
of finishing any change, before claiming it done.

## Stack & layout

- TypeScript, ESM, Node 20+. Test with Vitest (`npm test`). `npm test` runs two
  Vitest projects: `server` (data + server suites, node env) and `ui` (the SPA
  suite, jsdom env). `npm run typecheck` checks BOTH the server (`tsconfig.json`,
  which excludes `src/ui`) and the UI (`tsconfig.ui.json`).
- TDD: write the failing test first, then the minimal implementation.
- `src/data/` is the headless data layer; one responsibility per file; the server
  imports only from `src/data/index.ts`.
- Data layer modules: `record`, `schema`, `monetary`, `dataset`, `links`,
  `derive`, `search`. The `derive` functions take an injected `now: Date` for
  deterministic tests — never call `new Date()` (argless) inside them. Record IDs
  follow the prototype: `t-YYYY-MM-DD`, `m-<slug>`, `c-<slug>`, `v-<slug>`,
  `inv-<slug>`, `man-<slug>`, `qr-<slug>`.
- The record parser uses the `yaml` package (YAML 1.2 core) as gray-matter's
  engine so bare ISO dates in frontmatter stay strings (not Date objects).
- The data loader fails loud: it validates every record on load and rethrows any
  non-ENOENT error; only a genuinely missing file/dir is treated as "empty".

## Security invariant — cost data is owner-only

Cost/monetary data is visible to `owner` only. It MUST be redacted **server-side**
for `crew`/`guest`, never just hidden in the UI. The set of monetary fields lives
in `src/data/monetary.ts` (`MONETARY_FIELDS`, `OWNER_ONLY_COLLECTIONS`) and is
enforced at the response boundary by `src/server/redact.ts` (`redactDataset`),
guarded by the `redaction-golden` test; keep it in sync with the schemas (a test
enforces this). When you add a cost-bearing field, add it to that registry in the
same change.

## Server layer (P1b)

- `src/server/` is the read/write API: one responsibility per file; it imports the data
  layer **only** from `src/data/index.ts`. The app is a `createApp(deps)` factory
  with injected `{config, store, users, now}` — tests drive it via `supertest`
  in-process; `now` is injected so derived views stay deterministic.
- Auth: argon2id password hashing (`@node-rs/argon2`) + stateless HMAC-signed
  HTTP-only session cookies (`SESSION_SECRET`). The users store (`users.json`) is
  deployment state in a VPS volume — **never** committed to the data repo.
- **Redaction is enforced server-side by `src/server/redact.ts`** via
  `redactDataset(ds, role)`, driven by the `monetary.ts` registry (NOT the schema
  name-heuristic). Every read/search/derive route serves the role-scoped view, so
  monetary values never reach a crew/guest response or the search haystack. The
  `redaction-golden` test deep-walks every non-owner response and asserts no
  monetary key (and no owner-only record) ever appears — keep it passing; never
  weaken it.
- Demo mode (no `DATA_DIR`): every request is owner-equivalent and read-only,
  flagged via `GET /api/me`; login/writes are disabled.
- Transport-level hardening (HSTS, CSP) is deferred to P2 (VPS deployment behind
  the Pangolin tunnel); the app sets `X-Content-Type-Options: nosniff` and disables
  `X-Powered-By`, and returns JSON (not HTML) on errors.

## Write layer (P1c)

- All writes go through `ShipStore` (`src/server/store.ts`) — the single
  server-side writer. It owns the in-memory dataset snapshot, a **serial write
  queue**, and the git client. Every mutation runs `validate → write file →
  commit → reload-from-disk → atomic snapshot swap`; reads call `store.current()`,
  so a read never sees a torn dataset. `createApp` takes `store` (not a raw
  `dataset`).
- **Local commit only.** `src/server/git.ts` wraps `simple-git` to `add`+`commit`
  the working clone, authored as the logged-in user. `pull`/`push`/sync/conflicts
  are **P2**. If `DATA_DIR` is not a git repo, the store persists files **without**
  committing (warned) so local scratch dirs work.
- **Crew write scope:** crew may create/edit trips (`POST`/`PUT /api/trips`) and
  mark maintenance complete (`POST /api/maintenance/:id/complete`, a dedicated
  narrow op that can never touch `costEst`). Everything else (other collections,
  all `DELETE`s, full maintenance edit) is owner-only. Photo upload
  (`POST /api/photos`) is crew + owner. Every write route carries `denyInDemo`.
- **Redaction-on-write:** write responses pass through `redactRecord` (same
  `monetary.ts` registry) so a crew/guest write response never carries a monetary
  field; the `redaction-golden` test covers write responses too. When you add a
  cost-bearing field, register it in `monetary.ts` in the same change.
- Record ids are derived server-side in `src/data/write.ts` (`deriveId`): trips
  from their date, others from a slug of title/name/item, with numeric suffixes on
  collision. Photos (`src/server/photos.ts`) are validated + `sharp`-compressed
  (longest edge ≤ 2048 px, JPEG) and content-addressed under `photos/`.

## Web UI (P1d)

- `src/ui/` is the SPA (Vite + React 18 + TypeScript, ESM). It is a **pure API
  client**: it talks to the Express JSON API and never imports the server or data
  layer at runtime. Source UI types from `src/data/schema.ts` with `import type`
  only — bind to the **real** API shapes, never the prototype's mock `window.DATA`.
- **The prototype is a visual source, not code to copy.** `docs/prototype/`
  (index.html, app.css, app.jsx, icons.jsx, components.jsx, pages-*.jsx) is the
  original in-browser-Babel prototype. Recreate its *visual output* in clean
  React/TS; `src/ui/styles/app.css` is `docs/prototype/app.css` ported verbatim —
  it is the design-token system (brass/ink/parchment, Spectral + IBM Plex,
  status-signal colors, `.shell/.sidebar/.topbar/.card/.badge/.grid`). Do NOT
  reimplement the prototype's hardcoded-2024 `daysUntil` logic: derived
  overdue/due inventory tasks come from `GET /api/derived` (server clock).
- **Build/dev:** `vite.config.ts` has root `src/ui`, base `/`, and builds to
  `dist/ui` (gitignored). `npm run dev:ui` runs Vite on :5173 and proxies `/api`
  and `/photos` to the Express server on :8080, so the SPA develops against the
  real server in demo mode (`npm run dev`/`npm start` in another terminal).
  `npm run build:ui` / `npm run preview:ui` build/preview the bundle. In
  production the **Express server serves the built `dist/ui` itself** (see the
  static-serving bullet below).
- **Tooling:** the UI has its own `tsconfig.ui.json` (DOM libs, `jsx: react-jsx`,
  bundler resolution); the server `tsconfig.json` excludes `src/ui`. `npm test`
  runs the UI suite as a second Vitest **project** (jsdom + Testing Library +
  `@testing-library/jest-dom`, setup in `src/ui/test/setup.ts`) without touching
  the node server/data project. UI tests are `src/ui/**/*.test.tsx`, TDD as usual.

### SPA foundation (P1d / F2)

- **Layered, single-responsibility tree** mirroring the server's discipline:
  `src/ui/lib/` (`types.ts` = `import type`-only re-exports of the schema record
  types, so zod never enters the bundle; `api.ts` = the typed fetch client;
  `format.ts` = `fmtMoney`/`fmtDate`/`fmtDateShort`), `src/ui/state/session.tsx`
  (the auth/role context), `src/ui/AppRouter.tsx` (routing + guards),
  `src/ui/components/` (`Shell.tsx`, `Icon.tsx`, `atoms.tsx`), `src/ui/pages/`.
- **API client (`lib/api.ts`):** every request is same-origin with
  `credentials: 'include'`; non-2xx responses become an `ApiError` carrying the
  HTTP `status` + the server `{ error }` message, so callers branch on
  401/403/404/409/413/415/429/500 distinctly (crew → `/api/costs` is a 403). It
  has a method for every read in the contract plus `login`/`logout`/
  `changePassword`, the **owner user-admin** surface
  (`listUsers`/`createUser(username,password,role)`/`updateUser(username,{role?,
  password?})`/`deleteUser(username)` → `GET/POST/PUT/DELETE /api/users[/:username]`,
  owner-only so crew/guest get a 403), and the full write surface (P1d):
  `createTrip`/`updateTrip`/
  `deleteTrip`, `completeMaintenance`, owner `create*`/`update*`/`delete*` for
  maintenance|inventory|vendor|cost|manual (route paths use the **plural**
  collection dir — `vendor` → `/api/vendors`, `cost` → `/api/costs`), and
  `uploadPhoto(file)` (multipart field `photo`; we must NOT set `Content-Type`,
  the browser sets the boundary). `manualFileUrl(file)` builds the `/files/manuals`
  href. Writes take a `WritePayload` (flat fields + optional `body`); the server
  derives the id, so callers never send one.
- **Session (`state/session.tsx`):** on mount it fetches `GET /api/me` (which
  NEVER 401s — pure role/demo discovery) and exposes
  `{ loading, role, isOwner, isCrew, isAuthed(role!=='guest'), demo,
  ownerConfigured, login, logout, refresh }`. The role is learned from the
  server, **never** by reading the (HTTP-only) cookie; `login`/`logout` refresh
  `/api/me`. On a network failure it fails **safe** to guest (gate stays closed).
- **Router + guards (`AppRouter.tsx`, react-router-dom):** guest → only Welcome
  (`/`) + Login (gated routes redirect to `/login`); crew → all reads except
  Costs + Admin (owner-only, redirect home); owner → everything; demo → viewer is
  owner-equivalent and Login is disabled (`/login` redirects to Welcome). Record
  routes accept an `:id` param and pages honour `?focus=` to preserve the
  prototype's cross-link deep-linking (`navTo`+`focusId`).
- **Role-aware shell (`components/Shell.tsx`):** ports the prototype's
  sidebar/topbar/search-overlay/share-modal/mobile-drawer **visually**, but the
  boat name comes from `GET /api/welcome` (never hardcoded "Valkyrie"), the
  maintenance nav-badge is `GET /api/derived.attention` (server clock), the
  cmd-K/"/" search overlay queries `GET /api/search` and routes to the hit, Costs
  is owner-only + Admin owner-only in the nav, Login shows for a guest /
  user+logout+change-password for an authed viewer, and a persistent DEMO banner
  renders when `/api/me.demo`. The atoms in `components/atoms.tsx`
  (StatusBadge/Badge/Photo/Stat/SectionHead/WeatherRow/Card/Button/EmptyState)
  and `Icon.tsx` (Icon set + CompassRose) are typed against the real schema.
- **UI degrades on redaction:** when `costEst` is absent (crew/guest), render no
  cost row/link; the Costs nav item is hidden for non-owners; never assume the
  costs collection is fetchable as crew.

### Write form-kit (P1d) — `src/ui/components/forms/`

- The **single reusable kit** every create/edit page composes (one import surface
  via its barrel `index.ts`). Field primitives — `TextField`, `TextAreaField`
  (the Markdown `body`), `NumberField`, `DateField` (ISO `YYYY-MM-DD`),
  `SelectField` (enums, constrained to the schema's value set + a blank "unset"),
  `StringArrayField` (`crew[]`/`services[]`), and `GroupField` (repeatable object
  groups like `waypoints[]`/`findings[]`/`sections[]`) — are **controlled**
  (`value` + `onChange`) and mirror the Zod field shapes in `src/data/schema.ts`.
  The **`RecordForm`** shell renders title + Save/Cancel and surfaces an
  `ApiError.message` on a rejected submit (disabling Save while pending, to guard
  the serial write queue from a double-write). **`PhotoUpload`** calls
  `api.uploadPhoto`, maps 413/415/400 to friendly copy, and returns the
  `photos/<hash>.jpg` ref to append to the record's `photos[]` via a follow-up PUT.
- **`buildPayload(state, opts)` is mandatory before any write.** It OMITS blank
  optionals (a `''` is **never** sent — partial entries are first-class, e.g. a
  trip needs only `{ date }`), coerces declared `numbers` (dropping unparseable
  ones rather than sending `NaN`), trims/compacts declared `arrays`, drops
  empty/empty-row `objectArrays`, and leaves `body` on the payload for the server
  to split out. **Never hand-roll a payload** that could ship an empty string.
- Form styles live in a co-located **`forms.module.css`** (parchment tokens from
  `app.css`); the shared `app.css` is **never** edited.
- **Crew never sees a cost input:** pages must not render a cost field
  (`maintenance.costEst`, the whole `cost` collection) for crew/guest — mirror the
  read-side redaction posture on the write side.

### Static serving — photos, manual files + the built SPA (`src/server/static.ts`)

- **`GET /photos/:name`** streams a binary from `<dataDir>/photos/` (the demo dir
  in demo mode). It is **path-traversal-safe** (single path segment only; the
  decoded name is rejected if it contains a separator / `..` / NUL, and the
  resolved target must stay strictly inside the photos dir), content-typed by
  extension, and under the **same auth posture as reads**: open in demo,
  `requireAuth` otherwise. Photos are binaries — they carry no monetary JSON, so
  the redaction-golden invariant is unaffected.
- **`GET /files/manuals/:name`** (`registerManualRoute`, P1d) streams a manual's
  `file:` (PDF/markdown/etc.) from `<dataDir>/manuals/` with the **same hardening
  and auth posture** as the photo route. It is **scoped to `manuals/` only** — it
  is deliberately NOT a generic data-dir file server, so it can never reach
  `costs/*.md`; manuals carry no monetary data, so redaction-golden stays intact.
  Content type comes from a small document allowlist (`.pdf`/`.md`/`.txt`/image).
  The SPA builds the href via `api.manualFileUrl(file)` (strips a leading
  `manuals/` and encodes the name). **Do not** widen this into a generic
  `/files/:collection/:name` server.
- **Built-SPA serving:** `registerSpaStatic` serves `config.clientDir`
  (`CLIENT_DIR`, defaulting to `dist/ui` when present) with a **history-fallback**
  — a request for a real built asset streams that file, anything else returns
  `index.html` so client routes deep-link. It is a **no-op** when no build is
  configured.
- **Never shadow `/api`, `/photos`, or `/files`:** in `createApp` the order is API
  routes → an `/api`+`/photos`+`/files`-scoped JSON 404 → the SPA static handler
  (which also ignores all three) → a final JSON 404. An unknown `/api/*`,
  `/photos/*`, or `/files/*` path is therefore always a JSON 404, never
  `index.html`.

### Pages (P1d) — `src/ui/pages/`

- **`WelcomePage.tsx`** is the public, guest-visible page (route `/`). It sources
  **only** `GET /api/welcome` — the curated identity + welcome block
  (`name, make?, model?, year?, hailingPort?, welcome:{ rules?, whatToExpect?,
  whatToBring?, safety? }`). The server does **not** spread `boat.yaml` here, so
  the prototype's spec table / lat-lon / tagline / blurb have no real source and
  are intentionally omitted; **zero boat strings are hardcoded** — every value
  comes from the fetch. Each section renders only when its curated field is
  present, so a sparse boat still produces a clean page (graceful degradation).
  It carries its own in-page **Share hook** (a co-located `ShareModal`, mirroring
  the Shell's sidebar one) and a **Login affordance** shown only to an anonymous
  guest in a non-demo deployment (demo disables sign-in). Tested in
  `WelcomePage.test.tsx` against mocked `useSession` + `api.welcome` with
  demo-shaped fixtures.

- **`TripsPage.tsx`** is the trip-log list + detail (routes `/trips`,
  `/trips/:id`). It sources **only** `GET /api/trips` (`WithBody<Trip>[]`). The
  list shows a fleet stats header + photo-cover cards; a card opens the detail in
  place. The detail renders the **route timeline** (waypoints, types
  depart|anchor|arrive|waypoint), the **conditions** via `WeatherRow`, **crew**
  chips, **photos** (real `photos/<name>.jpg` refs served root-anchored by the
  `/photos` route — the ref already carries the `photos/` prefix), and the
  **findings**, each with a severity badge and, when it has a `maintId`, a
  cross-link to `/maintenance?focus=<id>` (the `?focus=` convention the Shell +
  AppRouter use). The narrative `body` is rendered as Markdown by a co-located,
  dependency-free **`Markdown.tsx`** that parses a small safe subset into React
  elements (never `dangerouslySetInnerHTML`, so no HTML-injection surface; link
  hrefs are restricted to http(s)/mailto/relative). A `/trips/:id` deep link or a
  `?focus=<id>` query opens that trip's detail directly; a `?focus=` on the list
  scroll-highlights its card. **Trips carry no cost data**, so the page is
  identical for owner/crew/guest-authed viewers and never renders a money figure.
  Page-local styles (Markdown typography + the detail's responsive grid collapse)
  live in a co-located **`TripsPage.module.css`** — the shared `app.css` is left
  untouched. Every optional Trip field degrades gracefully. Tested in
  `TripsPage.test.tsx` against a mocked `api.trips` with demo-shaped fixtures
  (list/detail render, finding cross-link navigates, photos resolve to the
  `/photos` URL, Markdown bold renders as `<strong>`, deep-link + focus open the
  detail, and no money/cost row ever appears for owner- or crew-shaped trips).

- **`MaintenancePage.tsx`** is the priority-queue + status-board read view + an
  item detail (routes `/maintenance`, `/maintenance/:id`). It sources
  `GET /api/maintenance` + `GET /api/derived` (the inventory tasks that surface in
  the queue) + `GET /api/vendors` + `GET /api/trips` (the last two feed the owner
  form pickers). **Cost redaction degrades gracefully:** `costEst` is stripped
  server-side for crew/guest, so when absent the page renders NO cost row, NO cost
  cross-link, and omits the "Est. outstanding" rollup — never `$NaN`. **Write
  affordances are role-correct and hidden in demo** (every write is
  `denyInDemo`): crew **and** owner get a real **Mark complete** control on a
  not-done item (an inline panel → `POST /api/maintenance/:id/complete
  { completed (default today), note? }`, which can never touch `costEst`); **owner
  only** gets full **create** ("Add item") / **edit** (incl. the `costEst` input +
  vendor + source-trip pickers) via the form-kit, and a confirm-guarded
  **delete** (`DELETE /api/maintenance/:id`). Crew never sees a cost input, an
  edit, or a delete (the API 403s them anyway). Every successful write refreshes
  the dataset (a `reloadKey` re-runs the load effect). Gating reads from
  `useSession()` (`isOwner`/`isCrew`/`demo`). Page-local styles live in
  `MaintenancePage.module.css`; the shared `app.css` is untouched. Tested in
  `MaintenancePage.test.tsx` against mocked `api` + `useSession` (crew sees
  Mark-complete but no delete/`costEst`/edit; owner sees full edit + delete; demo
  shows no write affordances; the cost redaction contract holds).

### Auth screens (P1d) — `src/ui/pages/{LoginPage,AccountPage,AdminPage}.tsx`

- **`LoginPage.tsx`** (route `/login`, gated to a non-demo guest by `LoginRoute`)
  POSTs `/api/login` via `session.login(u,p)` (which refreshes `/api/me` so the
  tree re-renders on the authoritative role), then redirects to the attempted
  path (`location.state.from`, set by `RequireAuth`), defaulting to `/`. **Error
  copy is GENERIC by design** — a wrong username and a wrong password both surface
  the same "didn't match, check and try again" line, mirroring the server's flat
  401 (`invalid credentials`) so there is **no user-enumeration**; a **429** is the
  one distinct case (a "too many attempts, wait a moment" notice). In demo the
  form is disabled with a read-only notice (login is a server 400 there).
- **`AccountPage.tsx`** (route `/account`, any authed user) POSTs `/api/password
  { currentPassword, newPassword }` via `api.changePassword`. It mirrors the
  server's **min-8** rule client-side (an obviously-short new password never
  round-trips; the server still re-checks), shows a success status, and surfaces
  the server 400 (`invalid current password`) verbatim. Demo disables it (400).
- **`AdminPage.tsx`** (route `/admin`, **owner-only** — `RequireOwner` + a server
  403) drives the four user endpoints: `GET /api/users` (the table),
  `POST /api/users` (add: username + **temporary** password the owner shares +
  role), `PUT /api/users/:username` (set role and/or **reset** password, via a
  modal), `DELETE /api/users/:username` (a confirm-modal-guarded remove). The
  server owns the invariants and they read straight back: **409** (`cannot
  demote/delete the last owner`, duplicate username), **404** (`no such user`),
  **400** (validation). After every successful mutation the list is **re-fetched**
  so the table reflects the authoritative server state. All three pages reuse the
  global `app.css` classes (no page-local stylesheet) and are tested in their
  `*.test.tsx` against mocked `api`/`useSession` (login success + 401 generic +
  429; change-password success + min-8 + wrong-current; admin list + create/
  update/delete happy paths + each error status).
