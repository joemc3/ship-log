# Ship's Log

A reusable, git-backed, self-hostable boat-management hub. Fork it, point it at
your own boat's data repo, and go. See the design spec in
`docs/superpowers/specs/2026-06-14-ship-log-design.md`.

## Status

The data core (P1a), the read server (P1b), the write layer (P1c), the SPA (P1d),
and the local-testable parts of **P2** are built: a headless data layer
(`src/data/`) plus an Express REST API (`src/server/`) with app-level auth
(signed-cookie sessions, three roles), server-side cost redaction, record writes
committed to the data repo, photo upload, and a Vite + React + TypeScript SPA
(`src/ui/`) that binds to the real API. **P2 adds two-way git sync** (clone on
boot → timed `pull --rebase` + post-write push, with a conflict-pause that never
force-pushes), **transport hardening** (HSTS + a same-origin CSP, on behind TLS),
and the **Docker/compose** packaging for the Pangolin-tunnel VPS. The remaining
P2 work is the actual VPS bring-up (and the SPA conflict banner that consumes
`GET /api/sync`); the sync engine, hardening, and deploy artifacts are testable
end-to-end locally against `file://` repos.

## Develop

```bash
npm install
npm test            # run BOTH Vitest projects once (server/data in node, UI in jsdom)
npm run test:watch  # watch mode
npm run typecheck   # tsc --noEmit for the server AND the UI (tsconfig.ui.json)
```

## Run the server

```bash
npm start          # production-style boot (tsx)
npm run dev        # watch mode
```

With no `DATA_DIR` the server runs in **demo mode**: it serves the bundled
`demo/` dataset read-only, with no auth and costs visible, clearly flagged via
`GET /api/me` (`demo: true`).

## Web UI (P1d)

The single-page app lives in `src/ui/` (Vite + React 18 + TypeScript). It is a
pure API client — it binds to the real server (types come from
`src/data/schema.ts`), never to the prototype's mock data.

```bash
npm run dev:ui      # Vite dev server on :5173, proxies /api + /photos → :8080
npm run build:ui    # production bundle → dist/ui (gitignored)
npm run preview:ui  # serve the built bundle locally
```

For local development run the API and the UI together: `npm run dev` (or
`npm start`) for the Express server on :8080, and `npm run dev:ui` in a second
terminal. The Vite dev server proxies `/api`, `/photos`, and `/files` to :8080,
so the SPA runs against the real server in demo mode. The original prototype lives in
`docs/prototype/` (the design-token system in `app.css` is ported verbatim to
`src/ui/styles/app.css`).

In production the Express server serves the built SPA itself: `npm run build:ui`
emits `dist/ui`, and the server (`src/server/static.ts`) serves it with a
history-fallback — any non-`/api`, non-`/photos`, non-`/files` route returns
`index.html` so client-side routes deep-link cleanly, while unknown `/api/*`,
`/photos/*`, and `/files/*` paths still return a JSON 404 (the SPA never shadows
the API or the served-file routes). Point the server at a build with
`CLIENT_DIR`; by default it serves `dist/ui` if that directory exists.

Two binary surfaces stream alongside the API, both traversal-safe and under the
read auth posture (open in demo, `requireAuth` otherwise): `GET /photos/:name`
(record photos from `<dataDir>/photos/`) and `GET /files/manuals/:name` (a
manual's PDF/markdown from `<dataDir>/manuals/`). The manual route is scoped to
`manuals/` **only** — it is not a generic data-dir file server, so it can never
reach `costs/*.md`; manuals carry no monetary data, so the redaction invariant is
unaffected. The SPA links to a manual via `api.manualFileUrl(file)`.

The SPA is structured as: `lib/` (typed API client + record types re-exported
type-only from `src/data/schema.ts` + display formatters), `state/session.tsx`
(role/demo discovery from `GET /api/me`), `AppRouter.tsx` (react-router routes +
role guards: guest → Welcome/Login only, crew → all reads except Costs/Admin,
owner → everything, demo → owner-equivalent with login disabled),
`components/Shell.tsx` (the role-aware sidebar/topbar/search-overlay/share-modal
shell), `components/` atoms (Icon, StatusBadge, etc.), and `pages/`.

`pages/WelcomePage.tsx` is the public, guest-visible page (route `/`). It reads
**only** `GET /api/welcome` — the curated identity + welcome block (boat name +
make/model/year/hailing port + `rules`/`whatToExpect`/`whatToBring`/`safety`) —
with no hardcoded boat strings and graceful degradation when a curated field is
absent. It carries an in-page Share-this-page modal and a Login affordance shown
only to an anonymous guest (hidden in demo, where sign-in is disabled).

`pages/TripsPage.tsx` is the trip-log list + detail (routes `/trips`,
`/trips/:id`), sourcing **only** `GET /api/trips`. The detail shows the waypoint
route timeline, conditions, crew, photos (served by the `/photos` route), the
findings (each with a severity badge and, when linked, a cross-link to
`/maintenance?focus=<id>`), and the Markdown `body` narrative rendered by a
small, dependency-free, XSS-safe renderer (`pages/Markdown.tsx`, React elements
only — no raw HTML). `?focus=<id>` / `/trips/:id` open + highlight a trip.
Trips carry no costs, so the page is identical for every authenticated role.

`pages/MaintenancePage.tsx` is the priority-queue + status-board read view + an
item detail (routes `/maintenance`, `/maintenance/:id`), sourcing
`GET /api/maintenance` + `/api/derived` (+ `/api/vendors` and `/api/trips` for
the owner form's vendor/source-trip pickers). The owner-only `costEst` is
stripped server-side for crew/guest, so when absent the page shows no cost row,
no cost link, and no "Est. outstanding" stat (never `$NaN`). Role-correct write
affordances — all hidden in demo: crew **and** owner get a **Mark complete**
control (→ `POST /api/maintenance/:id/complete`, never touching `costEst`);
**owner only** gets create ("Add item") / edit (incl. the `costEst` input +
vendor/source-trip pickers) and a confirm-guarded delete. Each write refreshes
the list.

`pages/LoginPage.tsx` (route `/login`, non-demo guests only) POSTs `/api/login`
and redirects to the originally-attempted path. Its error copy is deliberately
**generic** — a wrong username and a wrong password yield the same message (no
user-enumeration, mirroring the server's 401) — with a distinct "too many
attempts" notice on a 429 rate-limit; demo disables the form.
`pages/AccountPage.tsx` (route `/account`, any authed user) changes the password
via `POST /api/password`, mirrors the server's 8-char minimum client-side, and
surfaces success and the wrong-current-password error. `pages/AdminPage.tsx`
(route `/admin`, **owner-only**) is the user admin: list / add (with a temporary
password) / set-role / reset-password / delete against `/api/users`, reading the
server's last-owner (409), no-such-user (404), and validation (400) guards
straight back and re-fetching the list after each change.

Environment:

- `DATA_DIR` — path to the data working clone. Unset **and** `DATA_REPO_URL`
  unset ⇒ demo mode. When `DATA_REPO_URL` is set but `DATA_DIR` is unset, the
  clone materializes at `./var/data`.
- `DATA_REPO_URL` — remote data repo to **clone on boot** when `DATA_DIR` is
  empty/absent (an already-present clone is opened in place; never re-cloned or
  clobbered). Setting it (with or without `DATA_DIR`) is a configured deployment,
  so `SESSION_SECRET` is required and demo mode is off.
- `DATA_SSH_KEY_PATH` — path to an SSH **deploy key**; composed into
  `GIT_SSH_COMMAND` (`-i <key> -o IdentitiesOnly=yes -o
  StrictHostKeyChecking=accept-new`) for clone/remote ops.
- `DATA_REPO_TOKEN` — fine-grained **PAT** for an `https://` data-repo URL
  (injected as `x-access-token:<token>@…`). Use this *or* the SSH key, not both.
  On a missing/invalid credential the app **boots read-only** (serving the demo
  dataset as a stand-in) with a warning rather than crashing.
- `SESSION_SECRET` — required outside demo; signs session cookies.
- `OWNER_USERNAME` / `OWNER_PASSWORD` — seed the first owner on an empty store.
- `USERS_PATH` — users store location (default `./var/users.json`; never in the
  data repo; gitignored). **Boot fails loud if this resolves *inside* `DATA_DIR`**
  (the credential store must never enter the git data clone — see "Users store"
  below).
- `PULL_INTERVAL` — sync scheduler cadence in **seconds** (default 300 = 5 min);
  the app pulls the data remote on this timer (and once on boot). No-op in demo /
  when the clone has no remote.
- `PORT` (default 8080).
- `COOKIE_SECURE` — default `true`; set `false` for local http. It also gates the
  **transport hardening** (see below): with `COOKIE_SECURE=true` and not in demo
  (the behind-TLS posture) the app sends `Strict-Transport-Security` and a CSP with
  `upgrade-insecure-requests`; on plain http it omits HSTS and the upgrade directive
  so local dev is never pinned to https.
- **Docker-secret indirection:** `SESSION_SECRET`, `OWNER_PASSWORD`, and
  `DATA_REPO_TOKEN` each also accept a `<NAME>_FILE` form (e.g.
  `SESSION_SECRET_FILE=/run/secrets/session_secret`); the file's contents (trailing
  newline trimmed) become the value. The inline var wins when both are set; a
  missing `_FILE` path is a loud boot error. This is what `docker-compose.vps.yml`
  uses to read Docker secrets.

### Transport hardening (P2)

Every response carries `X-Content-Type-Options: nosniff`, `X-Powered-By` is off,
and a same-origin **Content-Security-Policy** (`default-src 'self'`; `script-src
'self'`; `style-src 'self' 'unsafe-inline'` for React/Vite's inline styles;
`img-src 'self' data:` for compressed/inline thumbnails; `connect-src 'self'`;
`frame-ancestors 'none'`; `object-src 'none'`). Behind TLS (`COOKIE_SECURE=true`,
non-demo) it adds **HSTS** (`max-age=31536000; includeSubDomains`) and
`upgrade-insecure-requests`; on plain http (local dev / demo) both are omitted so
nothing pins the browser to https. Errors are JSON, never HTML. (Lives in the
`hardeningHeaders` middleware in `src/server/app.ts`.)

### Users store (deployment state — back this up)

The hashed-credential users store (`USERS_PATH`, default `./var/users.json`) is
**deployment state, not data**: it lives on its own volume (`shiplog-users` →
`/app/var` in compose), is **never** committed to the data repo, and is the one
piece of state the data repo cannot regenerate. **Back up this volume** (snapshot
`/app/var/users.json`) — losing it means re-bootstrapping the owner and re-adding
every user. The boot-time guard refuses to start if `USERS_PATH` resolves inside
`DATA_DIR`, so a misconfiguration can never sweep credentials into git.

## Deploy (Docker, P2)

A multi-stage `Dockerfile` builds the image: stage 1 (`node:20-bookworm`) runs
`npm ci` and `npm run build:ui` (→ `dist/ui`); stage 2 (`node:20-bookworm-slim`)
ships prod deps + a globally-installed `tsx` (the server runs TypeScript directly
via `tsx src/server/index.ts`), the server/data source, the built SPA, and the
bundled `demo/`, laid out under `/app` so the entry's `import.meta.url`-relative
resolution (`../../demo`, `../../dist/ui`) still works. The runtime image installs
`git` (+ `openssh-client`, `ca-certificates`) because the git layer shells out to
it to clone/commit/pull/push the data repo. Native deps (`sharp`,
`@node-rs/argon2`) get their **linux** binaries because every install runs inside
the image — the host's `node_modules` is excluded by `.dockerignore`. The image
boots with **no network access** (verified under `--network none`): nothing is
fetched at start. It runs as the unprivileged `node` user.

Two compose files:

- `docker-compose.yml` (base, local dev) — one `shiplog` service from the
  Dockerfile; publishes `8080:8080`; wires `SESSION_SECRET`,
  `OWNER_USERNAME`/`OWNER_PASSWORD`, the data-repo/sync env
  (`DATA_REPO_URL`, `DATA_DIR`, `PULL_INTERVAL`, `DATA_SSH_KEY_PATH` /
  `DATA_REPO_TOKEN`), and `USERS_PATH`; and mounts **two separate named volumes** —
  `shiplog-users` at `/app/var` (the hashed-credential users store, never in git)
  and `shiplog-data` at `/app/data` (the data working clone). Leave
  `DATA_REPO_URL`/`DATA_DIR` unset to run in demo mode (sync disabled).
- `docker-compose.vps.yml` (override, mirrors DA-RAG) — resets `ports` to publish
  **nothing** (ingress is the Pangolin tunnel only), attaches to the **external**
  `pangolin` network at a pinned static IP, and sources `SESSION_SECRET`, the
  owner-bootstrap password, and the git deploy key as Docker **secrets**
  (`./secrets/*`). The pinned IP (`172.18.0.22`) is **PROVISIONAL** — reconcile it
  with the actual Pangolin/Gerbil subnet + IPAM before deploying.

```bash
docker compose up --build                                   # local dev (:8080)
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d   # VPS
```

The sync env keys above are pre-wired in compose. The **boot-time clone-or-open**
and credential plumbing (SSH deploy key / PAT) are implemented (see Environment
above), as are the **remote-sync git ops** — `GitRepo.pullRebase()` (rebase,
aborting cleanly on conflict) and `push()` (pull-rebase-and-retry once on a
non-fast-forward, never force-push). The **timed pull scheduler** and the
**observable sync-state** that drive them are implemented (see "Two-way sync"
below); the SPA conflict banner that consumes `GET /api/sync` is the remaining
P2 UI work.

### VPS deploy walkthrough

The end-to-end first-deploy path (the one Joe runs). It assumes the Pangolin/Gerbil
tunnel stack is already up and the data-repo host is GitHub.

1. **Fork the app.** Fork `ship-log` (this repo) to your account and clone it onto
   the VPS. Nothing boat-specific lives here — only code.
2. **Create the private data repo.** Make a private `<boat>-log` repo from the
   data-template (see P3) — this holds `boat.yaml`, `trips/`, `maintenance/`,
   `photos/`, etc. It is the source of truth the app clones and Cowork edits.
3. **Pick a credential mode** (the app clones/pulls/pushes the data repo as one of
   these — use exactly one):
   - **SSH deploy key (recommended).** Generate a keypair
     (`ssh-keygen -t ed25519 -f deploy_key -N ''`), add the **public** key to the
     `<boat>-log` repo's Deploy Keys with **write access**, and use an SSH
     `DATA_REPO_URL` (`git@github.com:you/<boat>-log.git`). Mount the **private**
     key as the `data_deploy_key` secret; the override points
     `DATA_SSH_KEY_PATH` at it.
   - **Fine-grained PAT.** Create a fine-grained token scoped to the single
     `<boat>-log` repo with read/write contents, use an `https://` `DATA_REPO_URL`,
     and provide the token via `DATA_REPO_TOKEN` (or `DATA_REPO_TOKEN_FILE` as a
     secret). The app injects it as `x-access-token:<token>@…` at clone time.
4. **Provide the secrets** the VPS override expects (it reads them as Docker
   secret files):
   ```bash
   mkdir -p secrets
   openssl rand -hex 32                > secrets/session_secret     # cookie-signing key
   printf 'choose-a-strong-password'   > secrets/owner_password     # first-owner password
   cp /path/to/deploy_key                secrets/data_deploy_key     # SSH mode only
   ```
   and set the non-secret env in a `.env` next to the compose files:
   ```bash
   OWNER_USERNAME=joe
   DATA_REPO_URL=git@github.com:you/your-boat-log.git
   DATA_DIR=/app/data
   COOKIE_SECURE=true
   # PULL_INTERVAL=300       # optional; SECONDS, default 300 = 5 min
   ```
   (`SESSION_SECRET` + `OWNER_PASSWORD` come from the secret files via their
   `*_FILE` indirection; `OWNER_USERNAME` stays plain env.)
5. **Reconcile the pinned IP.** `docker-compose.vps.yml` pins `172.18.0.22` on the
   external `pangolin` network — confirm the network's real subnet and a free high
   static address with your Gerbil IPAM, update that value **and** the Pangolin
   target, then validate: `docker compose -f docker-compose.yml -f
   docker-compose.vps.yml config`.
6. **Bring it up.** `docker compose -f docker-compose.yml -f docker-compose.vps.yml
   up -d --build`. On first boot the app clones `<boat>-log` into the `shiplog-data`
   volume, bootstraps the owner from `OWNER_USERNAME`/`OWNER_PASSWORD`, and starts
   the sync scheduler. (No host ports are published; reach it only through the
   Pangolin tunnel.)
7. **Log in as owner** through the tunnel URL, change the bootstrap password under
   **Account**, and add crew/guest users under **Admin**. Sync state shows on
   `GET /api/me` / `GET /api/sync`.

### Credential modes at a glance

| Mode    | `DATA_REPO_URL`                       | Credential env                                  | GitHub side                          |
|---------|---------------------------------------|-------------------------------------------------|--------------------------------------|
| SSH key | `git@github.com:you/<boat>-log.git`   | `DATA_SSH_KEY_PATH` → mounted private key       | public key as a write **Deploy Key** |
| PAT     | `https://github.com/you/<boat>-log.git` | `DATA_REPO_TOKEN` (or `DATA_REPO_TOKEN_FILE`) | fine-grained PAT, repo-scoped, r/w   |

On a missing/invalid credential the app **boots read-only** (serving the demo
dataset as a stand-in) with a warning rather than crashing, so a bad key never
takes the site down — fix the credential and restart to resume sync.

## Two-way sync (P2)

The VPS app is the single server-side writer; Cowork edits the same data repo
through GitHub. They converge over git:

- **After a write**, the store commits locally then `pull --rebase` + `push`. A
  non-conflicting concurrent Cowork push is rebased in and both land on the remote
  (neither is lost); the app's in-memory dataset is reloaded so it reflects
  Cowork's change immediately.
- **On a conflict** (both edited the same file), the rebase aborts to a clean
  tree, the app keeps its write **committed locally**, sync-state goes
  `conflict`, and **auto-push pauses** (later writes commit-only) until a clean
  pull clears it — resolved out-of-band via Cowork/CLI. It **never force-pushes**;
  the remote keeps both histories.
- **On a transport/credential failure**, sync-state goes `offline`; the local
  commit pushes on a later successful sync.
- **The scheduler** (`src/server/sync.ts`) runs `pull --rebase` on boot and every
  `PULL_INTERVAL`, routed through the store's write queue, so a Cowork push is
  picked up even with no local writes. `index.ts` starts it only outside demo /
  read-only and when the clone has a remote, and stops it on `SIGTERM`/`SIGINT`.
- **Clients** see sync via the `sync` summary on `GET /api/me`
  (`{status, enabled, lastPullAt, lastPushAt}` — authenticated/demo only, no error
  detail) and the dedicated authenticated `GET /api/sync` (adds a **generic**
  `lastError`; a remote URL/path is never leaked). Guests get neither.

**Resolving a `conflict`.** A conflict means the same file diverged on the app and
on the remote (e.g. owner edited `boat.yaml` in-app while Cowork edited it on
GitHub). The app holds at `status: 'conflict'`, keeps **both** commits (its own
locally, the remote's on origin), and **pauses auto-push** — every later write
still commits locally, so nothing is lost. Resolve it out-of-band:

1. Resolve the divergence on the remote — either let **Cowork** reconcile the
   `<boat>-log` repo, or do it by hand: clone the repo, `git rebase`/merge the two
   histories, and push the reconciled result.
2. The app clears the conflict on its **next clean pull** — wait for the scheduler
   (`PULL_INTERVAL`) or restart the container to pull on boot. Once a pull lands
   cleanly, `status` returns to `ok` and the paused local commits push on the next
   write. The app **never force-pushes**, so the remote history is always intact to
   resolve from.

## Write API (P1c)

Authenticated writes are committed to the local data working clone — one commit
per change, authored as the logged-in user — and then synced to the remote (see
"Two-way sync" above; P1c committed locally only). If `DATA_DIR` is not a git repo,
writes still persist to disk but are not committed (a warning is logged at boot);
a repo with no remote commits but does not sync.

- `POST /api/trips`, `PUT /api/trips/:id` — create/edit trips (crew + owner).
- `POST /api/maintenance/:id/complete` — mark a maintenance item done with a
  completion date + optional note (crew + owner).
- `POST`/`PUT` `/api/{maintenance,inventory,vendors,costs,manuals}` and
  `DELETE /api/{collection}/:id` — owner only.
- `POST /api/photos` — multipart upload (field `photo`); the server compresses
  with `sharp` (longest edge ≤ 2048 px, JPEG) and returns `{ ref }` (crew + owner).

Record ids are derived server-side (`t-<date>` for trips; `<prefix>-<slug>` from
the title/name/item otherwise), with `-2`, `-3`… on collision. All writes are
disabled in demo mode, and write responses are role-redacted exactly like reads,
so monetary fields never reach a crew/guest response.

## Layout

- `src/data/` — the data layer: `record` (frontmatter parse/serialize), `schema`
  (Zod schemas + types), `monetary` (cost-field registry), `dataset` (load a data
  dir), `links` (cross-link integrity), `derive` (inventory tasks + attention),
  `search`, `write` (record↔file + server-side id derivation). Public API is
  `src/data/index.ts`.
- `src/server/` — the server: `config`, `session`, `users` (argon2id store),
  `redact` (role-scoped dataset view + per-record redaction), `middleware`,
  `store` (`ShipStore`: in-memory snapshot + serial write queue + reload), `git`
  (local commit), `photos` (`sharp` compression), `static` (traversal-safe photo
  + manual-file streaming, scoped to `photos/` and `manuals/` respectively, plus
  built-SPA serving with history-fallback), `routes/` (auth, data, admin, writes),
  `app` (`createApp` factory), `index` (boot). Imports the data layer only from
  `src/data/index.ts`.
- `src/ui/` — the SPA (Vite + React 18 + TS): `main.tsx` (React 18 `createRoot`),
  `App.tsx` → `AppRouter.tsx` (session + router + shell), `lib/` (`api.ts` typed
  fetch client, `types.ts` type-only record re-exports, `format.ts` formatters),
  `state/session.tsx` (auth/role context), `components/` (`Shell.tsx`, `Icon.tsx`,
  `atoms.tsx`, and `forms/` — the reusable write form-kit), `pages/` (one component
  per page), `styles/app.css` (the design system, ported from the prototype),
  `vite.config.ts` (root `src/ui`, builds to `dist/ui`, dev proxy to :8080),
  `index.html`, and `test/setup.ts` (jest-dom for the jsdom suite).
- `src/ui/components/forms/` — the write form-kit (one import surface via its
  barrel `index.ts`): field primitives (`TextField`, `TextAreaField` for the
  Markdown `body`, `NumberField`, `DateField`, `SelectField`, `StringArrayField`,
  `GroupField` for repeatable object groups like waypoints[]/findings[]/
  sections[]), the `RecordForm` shell (title + Save/Cancel + an `ApiError.message`
  error surface), `PhotoUpload` (calls `api.uploadPhoto`, surfaces 413/415/400
  friendly errors, returns the `photos/<hash>.jpg` ref to append to photos[]), and
  `buildPayload` — which OMITS blank optionals (never sends `''`; partial entries
  are first-class), coerces declared numbers/arrays, and leaves `body` for the
  server to split out. Co-located `forms.module.css` (never touches `app.css`).
- `test/data/` — Vitest unit tests for the data layer.
- `test/server/` — Vitest + supertest tests for the server (auth, reads, redaction,
  admin, demo, writes, store, git, photos, static photo/SPA serving, manual-file
  streaming).
- UI tests live next to the code as `src/ui/**/*.test.tsx`; `vitest.config.ts`
  runs them as a second jsdom project alongside the node server/data project.
- `demo/` — a sample "Valkyrie" dataset used by tests and demo mode.
- `docs/` — design spec, implementation plans, and the `prototype/` design source.
