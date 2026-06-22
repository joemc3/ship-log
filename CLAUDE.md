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
- **Transport hardening** (`hardeningHeaders` in `src/server/app.ts`): every
  response sets `X-Content-Type-Options: nosniff`, disables `X-Powered-By`, sets a
  same-origin **CSP**, and returns JSON (not HTML) on errors. Behind TLS
  (`COOKIE_SECURE=true` and non-demo) it adds **HSTS** + the CSP
  `upgrade-insecure-requests` directive; on plain http / demo both are omitted so
  local dev is never pinned to https. See the "Sync & deploy (P2)" section.

## Write layer (P1c)

- All writes go through `ShipStore` (`src/server/store.ts`) — the single
  server-side writer. It owns the in-memory dataset snapshot, a **serial write
  queue**, and the git client. Every mutation runs `validate → write file →
  commit → reload-from-disk → atomic snapshot swap`; reads call `store.current()`,
  so a read never sees a torn dataset. `createApp` takes `store` (not a raw
  `dataset`).
- **Local commit only.** `src/server/git.ts` (`GitRepo`) wraps `simple-git`.
  `commitPaths(paths, message, author?)` stages **only** the precise repo-relative
  path(s) a write touched — adds/edits via `git add`, deletions via `git rm
  --ignore-unmatch` — then commits (NEVER `git add .`), so an unrelated dirty file
  is never swept into a write's commit (golden-tested in `git.test.ts` +
  `store.test.ts`). The store passes `recordPath(...)` / `photos/<name>` for each
  mutation. Commits are authored as the logged-in user; `FALLBACK_AUTHOR`
  (`Ship's Log <shiplog@localhost>`) is the generic identity for any system
  commit (used when no author is supplied). **`git commit` also needs a separate
  committer identity** (the per-commit `--author` only sets the author), which
  git otherwise auto-detects from the host's git config / OS account — absent on
  a fresh deploy clone (e.g. the slim image's `node` user has an empty GECOS and
  no `~/.gitconfig`), making `git commit` abort *after* `git add` and strand the
  write staged-but-uncommitted. So `GitRepo.open` sets the clone's **local**
  `user.name`/`user.email` to `FALLBACK_AUTHOR` (the app is the committer; the
  author stays the logged-in user), guaranteeing commits succeed in an
  identity-less environment (golden-tested in `git.test.ts`). If `DATA_DIR` is
  not a git repo, the store persists files **without** committing (warned) so
  local scratch dirs work.
- **Remote sync (P2, git layer).** `GitRepo.pullRebase()` / `push()` wrap
  `simple-git`'s `pull --rebase` / `push` and return structured results (never
  throw on the expected conflict path). `pullRebase()` → `PullResult { status:
  'up-to-date' | 'fast-forward' | 'conflict' | 'error' | 'disabled', ok, conflict,
  message? }`: on a rebase conflict it runs `rebase --abort` so the tree returns
  to its original clean HEAD and reports `conflict:true`; a transport/credential
  failure (no rebase started) is `status:'error'`, not a conflict. `push()` →
  `PushResult { status: 'pushed' | 'up-to-date' | 'conflict' | 'error' |
  'disabled', ok, conflict, message?, pull? }`: on a non-fast-forward rejection it
  runs `pullRebase()` then retries the push **once**; if that pull hit a conflict
  the push is **skipped** and the conflict surfaced (`pull` carries the
  `PullResult`). It NEVER force-pushes and never clobbers the remote; when the dir
  is not a repo both are no-ops (`status:'disabled'`). `GitRepo.hasRemote()` /
  `headSha()` support the sync layer (a repo with no `origin` is committable but
  not syncable; the store keys "reload after pull" off a HEAD-advance, since a
  rebase that replays a local commit reports zero touched files).
- **Sync engine (P2).** `ShipStore` owns observable sync state
  (`syncState() → { status: 'ok' | 'conflict' | 'offline', lastPullAt?,
  lastPushAt?, lastError? }`), mutated **only** inside the serial write queue / the
  scheduler's queued pull so it never disagrees with the snapshot. After a write's
  local commit the store runs `pullRebase → push`: on a rebase **conflict** it
  persists locally, sets `status:'conflict'`, and **pauses auto-push** (later
  writes commit-only) until a clean pull clears it; a transport/credential failure
  sets `status:'offline'` (the commit pushes on a later success). `lastError` is a
  **generic, sanitized** reason (never a remote URL/path). The pull-on-HEAD-advance
  triggers `reload()`. `store.pull()` routes a pull through the queue (used to
  clear a conflict and by the scheduler). `src/server/sync.ts` `SyncScheduler` runs
  `store.pull()` once on boot then every `PULL_INTERVAL` (default 5 min; the
  `Timer` is injectable for deterministic tests, ticks are coalesced); it is inert
  unless `store.syncEnabled()`. `index.ts` starts it only when non-demo, not
  read-only, and syncable, and stops it on `SIGTERM`/`SIGINT`. Sync surfaces to
  clients via the `sync` summary on `GET /api/me` (authenticated/demo only —
  `{status, enabled, lastPullAt, lastPushAt}`, **no** error detail) and the
  dedicated authenticated `GET /api/sync` (adds the generic `lastError`); guests
  get neither (`/api/sync` → 401).
- **Boot: clone-or-open.** `src/server/boot.ts` (`prepareStore(config, {now?,
  fallbackDir?})`) ensures the working clone exists, then opens a `ShipStore` over
  it. With `DATA_REPO_URL` set and an empty/absent `DATA_DIR` it `GitRepo.clone`s
  the remote (SSH deploy key via `DATA_SSH_KEY_PATH` → `GIT_SSH_COMMAND`, or
  `DATA_REPO_TOKEN` PAT for https); an existing clone is opened in place (never
  re-cloned/clobbered). A clone/credential failure boots **read-only** over the
  demo `fallbackDir` with a warning instead of crashing. Demo mode (no `DATA_DIR`,
  no `DATA_REPO_URL`) opens the bundled demo dir with sync disabled. `index.ts`
  wires this; config gains `dataRepoUrl`/`sshKeyPath`/`repoToken`
  (`DEFAULT_CLONE_DIR = ./var/data` when only `DATA_REPO_URL` is set).
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

## Hardening & config invariants (P2)

- **Transport hardening lives in one place** — the `hardeningHeaders(config)`
  factory in `src/server/app.ts`, mounted as the first middleware. It always sets
  `nosniff` + a same-origin **CSP** (`default-src 'self'`; `script-src 'self'`;
  `style-src 'self' 'unsafe-inline'`; `img-src 'self' data:`; `connect-src 'self'`;
  `frame-ancestors 'none'`; `object-src 'none'`; `base-uri`/`form-action 'self'`).
  "Behind TLS" is `config.cookieSecure && !config.demo`; only then does it add
  **HSTS** (`max-age=31536000; includeSubDomains`) and CSP
  `upgrade-insecure-requests`. Never send HSTS on plain http (it would pin a
  localhost browser to https). If you add a new asset origin (CDN, font host),
  widen the matching CSP directive here — do not sprinkle per-route headers.
  Guarded by `test/server/app.test.ts` (prod posture sets HSTS+CSP, local/demo omit
  HSTS, the API still returns JSON).
- **Users-store-volume invariant (`config.ts`):** boot **fails loud** if
  `USERS_PATH` resolves *inside* `DATA_DIR` (resolved-path containment check, so
  `..` and shared-prefix siblings like `/srv/data` vs `/srv/data-backup` are judged
  correctly). The hashed-credential store must never enter the git data clone. The
  guard is skipped in demo (the demo dir is read-only). The users store is the one
  piece of deployment state the data repo can't regenerate — **back up its volume**
  (`shiplog-users` → `/app/var`). Tested in `config.test.ts`.
- **Docker-secret `*_FILE` indirection (`config.ts`):** `SESSION_SECRET`,
  `OWNER_PASSWORD`, and `DATA_REPO_TOKEN` each also accept a `<NAME>_FILE` form
  (the file contents, trailing newline trimmed, become the value); the inline var
  wins when both are set and a missing `_FILE` path is a loud boot error. This is
  how `docker-compose.vps.yml` feeds Docker secrets in. When you add a new
  secret-bearing env var, add it to `SECRET_FILE_VARS` so the secret-file form
  works. Tested in `config.test.ts`.

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

## Conditions (weather + tides)

- **`conditions.md` singleton** — a YAML-frontmatter file at the data-repo root
  (like `boat.yaml`), not a collection. Parsed by `conditionsSchema` (in
  `src/data/schema.ts`) and exposed as `Dataset.conditions` (optional, `null`
  when absent). Two modes: `source: api` (server fetches live data) and
  `source: agent` (a Cowork/Hermes agent fills the file on a cron).
- **`GET /api/conditions`** — all-access (no auth required in demo; `requireAuth`
  in non-demo, but NOT owner-only). In `api` mode the server fetches live weather
  from Open-Meteo and tides from NOAA CO-OPS via `src/server/conditions/` (a TTL
  cache avoids hammering the upstreams on every page load); in `agent` mode it
  serves the file contents directly. `CONDITIONS_FETCH=false` disables all
  outbound fetches (useful for air-gapped deployments; agent mode still works).
- **All-access, no monetary data.** Conditions carries no cost or owner-sensitive
  fields. The `redaction-golden` test covers every non-owner response — keep it
  passing. Never add a monetary field to `conditionsSchema`.
- **NOAA tides are US-only.** In `api` mode the NOAA CO-OPS fetch only works for
  US coastal stations. For non-US locations, use `source: agent` and have the
  agent source regional tide data.
- **`update-conditions` Cowork skill** — canonical in `data-template/`, mirrored
  to `demo/`, instructs a scheduled agent to refresh `conditions.md`. See the
  skill for the step-by-step workflow.
- **Same-change rule:** when you add or rename a Conditions schema field (in
  `conditionsSchema`), update `SCHEMA.md` and `AGENTS.md` (the `data-template/`
  canonicals, then `cp` to `demo/`) in the same change, or the doc-drift / mirror
  tests will fail.

## Docker & VPS deployment (P2)

- Four artifacts (`Dockerfile`, `.dockerignore`, `docker-compose.yml`,
  `docker-compose.vps.yml`) package the app for the Pangolin-tunnel VPS, mirroring
  the DA-RAG pattern. **The runtime layout under `/app` is load-bearing:** the
  entry resolves the repo root as `../..` from `src/server`, so `demo/` and
  `dist/ui` MUST sit at `/app/demo` and `/app/dist/ui`. Preserve that if you change
  the image layout.
- **Multi-stage Dockerfile:** stage 1 (`node:20-bookworm`) `npm ci` + `npm run
  build:ui`; stage 2 (`node:20-bookworm-slim`) ships **prod deps only** plus a
  **globally-installed pinned `tsx`** (the server runs TS directly — there is no
  server compile; a local `--no-save` tsx install is pruned under
  `NODE_ENV=production`, so it is `npm install -g tsx@<pin>`). The runtime image
  installs **`git`** (+ `openssh-client`, `ca-certificates`) because the git layer
  shells out to it for clone/commit/pull/push. Native deps (`sharp`,
  `@node-rs/argon2`) get **linux** binaries because every install runs in-image;
  `.dockerignore` excludes the host `node_modules` so darwin binaries never leak
  in. Boots with **no network** and runs as the unprivileged `node` user.
- **Two named volumes, never merged:** `shiplog-users` at `/app/var` (the
  hashed-credential users store, `USERS_PATH`, never in git) and `shiplog-data` at
  `/app/data` (the git working clone, `DATA_DIR`). The base compose publishes
  `8080:8080` for local dev and wires the sync env (`DATA_REPO_URL`, `DATA_DIR`,
  `PULL_INTERVAL`, `DATA_SSH_KEY_PATH`/`DATA_REPO_TOKEN`). Unset
  `DATA_REPO_URL`/`DATA_DIR` ⇒ demo mode (sync disabled).
- **`docker-compose.vps.yml` override:** `ports: !reset []` (publish nothing —
  ingress is the Pangolin tunnel only), attach to the **external `pangolin`**
  network at a **pinned static IP**, and source `SESSION_SECRET` + owner-bootstrap
  password + the git deploy key as Docker **secrets**. The secret env uses the
  `*_FILE` indirection (`SESSION_SECRET_FILE`, `OWNER_PASSWORD_FILE` →
  `/run/secrets/*`), which `config.ts` resolves (see "Hardening & config
  invariants"); `DATA_SSH_KEY_PATH` points at the mounted deploy key. The pinned IP
  (`172.18.0.22`) is **PROVISIONAL** — reconcile with Joe's Gerbil IPAM/subnet
  before deploy. Validate both files with `docker compose -f docker-compose.yml
  [-f docker-compose.vps.yml] config`.
- **Behind TLS:** the Pangolin tunnel terminates TLS upstream, so production runs
  with `COOKIE_SECURE=true` — which is also what flips on HSTS + the CSP
  `upgrade-insecure-requests` (see "Hardening & config invariants"). Keep
  `COOKIE_SECURE=true` in the VPS shape.
- **First deploy** (fork app → private `<boat>-log` data repo → deploy key / PAT →
  secrets → reconcile pinned IP → `compose up` → log in as owner) is walked through
  step-by-step in `README.md` ("VPS deploy walkthrough" + "Credential modes").

## Optional assistant (Purser) layer

- **Three units:**
  - `src/server/assistant.ts` — the OpenAI-compatible streaming client. Sends the
    chat history + system message to the agent via `POST /v1/chat/completions`
    (streaming) and pipes the SSE response back to the browser. Injects
    `X-Hermes-Session-Id` (shared conversation id, `ASSISTANT_SESSION_ID`) and
    `X-Hermes-Session-Key` (the authenticated username, per-crew memory) as headers
    derived from `req.viewer` — never from the client.
  - `src/server/chatlog.ts` — the shared, capped transcript store. Persists the
    communal turn history in the **users volume** (`/app/var`, alongside
    `users.json`) — **never** in the data repo. The log is capped to a fixed window
    to bound size and context length.
  - `src/server/routes/assistant.ts` — the route handlers:
    `GET /api/assistant/history` (read the transcript), `POST /api/assistant/chat`
    (send a turn, stream the reply), `DELETE /api/assistant/history` (clear the
    log). All three routes require authentication; guests get a 401.

- **Photo / vision input (Phase 2).** `POST /api/assistant/chat` accepts either
  `application/json` (`{ message }`) or `multipart/form-data` (`message` + optional
  `photo` field). When a photo is present the server compresses it via `compressPhoto`
  (longest edge ≤ 2048 px, JPEG — the same pipeline as `POST /api/photos`) and
  converts it to a base64 `data:` URI forwarded to the agent as an `image_url`
  content part alongside the text message. Error map: unsupported MIME type → 415,
  file too large → 413. The chat photo is noted in the transcript as `image: true`
  but is **NOT persisted as a file** by the app — the agent may persist to the data
  repo through its own tools (e.g. opening a maintenance item), but the image itself
  is ephemeral. Re-displaying chat photos in the history is a possible later addition
  (the `image: true` flag marks the slot). **Vision requires a vision-capable agent
  model** — a text-only model will ignore the image without error.

- **Optionality:** `registerAssistantRoutes` is a no-op when `ctx.assistant` is
  absent. `index.ts` only builds `AssistantDeps` when `config.assistant` is set,
  which requires both a non-demo environment and `ASSISTANT_URL`. When unset, no
  routes are registered and `/api/me` returns `assistant: { enabled: false }`.
  `/api/me` carries `assistant: { enabled, label }` for authed and demo viewers
  (same shape as the `sync` summary).

- **Identity injection:** the speaker system message + `X-Hermes-Session-Id`
  (shared) + `X-Hermes-Session-Key` (`username`) are all server-derived from
  `req.viewer`. The client never supplies them — a crew member cannot claim to be
  the owner.

- **Generic-naming rule:** no specific boat name or agent name is hardcoded in the
  repo. The nav item and page title come from `ASSISTANT_LABEL` (default `"Ask the
  Purser"`). "Purser" is the generic role/default label; the operator's agent
  identity is their own.

- **Cost-redaction exception (intentional, owner-authorized).** The assistant
  streams agent free-text — not dataset JSON — so `redaction-golden` is unaffected.
  Because the agent's answers are not drawn from the dataset, there is nothing for
  `redactDataset` to strip. If a crew member asks the agent a cost question it may
  answer based on whatever the agent was trained on. The owner accepted this by
  enabling the feature. **Do not treat crew access to the assistant page as a
  redaction bug** — it is correct by design. Never route dataset JSON through the
  assistant endpoint.

- **Same-change rule:** when you add an `ASSISTANT_*` config var, update
  `config.ts` (add to `SECRET_FILE_VARS` if secret-bearing), `docker-compose.yml`
  (new env line in the Purser block), `README.md` (the config table), and this
  section together. The `_FILE` indirection pattern for secret-bearing vars is
  described in "Hardening & config invariants" above.

## Data repos & Cowork enablement (P3)

There are **two** datasets in this monorepo, and they are deliberately distinct —
never conflate them:

- **`demo/`** — the populated *Valkyrie* set. It is the demo-mode dataset and the
  fixture the data/server tests load. Has real records in every collection.
- **`data-template/`** — the **empty seed** a forker instantiates their own private
  `<boat>-log` data repo from. It carries the full *shape* but **no records**: a
  schema-valid placeholder `boat.yaml` (required `name`, empty-string `make`/
  `model`/`hailingPort`, `specs: {}`, `welcome:{rules:[],whatToExpect:'',
  whatToBring:[],safety:''}`; `year` is documented-but-omitted because the schema
  types it as a *number* with no empty-number placeholder), an empty
  `quickref.yaml` (`[]`), and the six collection dirs + `photos/` each kept in git
  by a `.gitkeep`. `loadDataset('data-template')` must succeed and yield all-empty
  collections — guarded by `test/data/data-template.test.ts`. Keep
  `data-template/` genuinely empty of records.
- **Worked examples live under `data-template/examples/`** — one commented
  `*.md` per collection showing the field shape, plus a `half-written-trip/`
  fixture (a sparse trip + a photo placeholder + a `manuals/` reference) that the
  `complete-trip` skill researches against and the output-contract test pins to.
  The loader **never scans `examples/`**: `loadCollection` reads `*.md` directly
  (non-recursively) in a *collection* dir (`trips/`, `maintenance/`, …) only, so
  neither the commented examples nor the fixture's subfolders can pollute a
  dataset. That is why the example frontmatter is also left commented — a
  human/Cowork sees the shape; nothing is ever loaded by accident.

**The docs live in the DATA repo and MIRROR `src/data/` as the source of truth.**
The three Cowork-facing docs — `AGENTS.md`, `SCHEMA.md`, and the `complete-trip`
skill (`.claude/skills/complete-trip/SKILL.md`) — are not free-standing prose:
they teach, by hand, exactly what `src/data/` enforces. `src/data/` is always the
source of truth; the docs follow it, never the reverse. They are authored
**canonically under `data-template/`** and **byte-copied into `demo/`** (so a fork
of either dataset carries them). All three now exist:

- **`AGENTS.md`** — Cowork's entry point: what the repo is, the file layout, the
  ground rules, and the research-and-write workflow. Points at `SCHEMA.md` for
  per-field detail rather than duplicating it.
- **`SCHEMA.md`** — the per-record contract: fields, id/slug rules, the cross-link
  table, enums, and the owner-only monetary tags. Mirrors the Zod schemas.
- **`complete-trip` skill** — the trip-completion workflow (read → view photos →
  research web + `manuals/` → write narrative → open the two-way-linked
  maintenance item → commit & push). It **references `SCHEMA.md`'s id/slug/monetary
  rules rather than restating them**, and is runtime-agnostic (Cowork skill or a
  `/complete-trip` slash-command).

**Doc-drift guard (keep green):** `test/data/p3-doc-drift-golden.test.ts` is the
P3 analogue of the redaction golden. It (a) asserts every collection dir, id
prefix, monetary field + owner-only collection, cross-link field, and status /
severity / waypoint enum — all read back from the `describe.ts` descriptor —
appears verbatim in `SCHEMA.md` (and that NO monetary field is omitted from its
monetary section), and (b) asserts the `demo/` copies of `AGENTS.md`, `SCHEMA.md`,
and `SKILL.md` are byte-identical to the `data-template/` canonicals.
(`cowork-docs-mirror.test.ts` and `schema-doc.test.ts` add finer prose checks.)
Never weaken it.

**Same-change rule (extends the cost-data invariant):** when you add or rename a
**monetary, cross-link, or collection field**, update `src/data/schema.ts`,
`src/data/monetary.ts` / `src/data/links.ts` / `src/data/write.ts`, **and**
`SCHEMA.md` + `AGENTS.md` (the `data-template/` canonicals, re-synced to `demo/`)
**in the same change** — the doc-drift guard will fail until you do. Treat the
docs as part of the schema's public surface.

**Cowork operates on a git clone of the DATA repo, NEVER through the running app
or its REST API.** The app is the single server-side writer and pulls Cowork's
pushes on a timer; the skill must only edit files + `git commit`/`push`, never
call an API endpoint. Cowork docs must teach that **cost data is owner-sensitive**
(`costs/` is owner-only; `maintenance.costEst` is a money field) and must **never
be surfaced in crew-facing trip narratives** — the redaction in `redact.ts` only
protects the API surface, not a narrative a writer pastes into a trip body.
