# Ship's Log

A reusable, git-backed, self-hostable boat-management hub. Fork it, point it at
your own boat's data repo, and go. See the design spec in
`docs/superpowers/specs/2026-06-14-ship-log-design.md`.

## Status

In development. The data core (P1a), the read server (P1b), and the write layer
(P1c) are built: a headless data layer (`src/data/`) plus an Express REST API
(`src/server/`) with app-level auth (signed-cookie sessions, three roles),
server-side cost redaction, record writes committed to the local data repo, and
photo upload. The SPA (P1d) is underway: a Vite + React + TypeScript front end in
`src/ui/` that binds to the real API, with the role-aware app shell + routing in
place and the Express server serving the built bundle (and repo photos). Two-way
git sync (P2) follows.

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
terminal. The Vite dev server proxies `/api` and `/photos` to :8080, so the SPA
runs against the real server in demo mode. The original design prototype lives in
`docs/prototype/` (the design-token system in `app.css` is ported verbatim to
`src/ui/styles/app.css`).

In production the Express server serves the built SPA itself: `npm run build:ui`
emits `dist/ui`, and the server (`src/server/static.ts`) serves it with a
history-fallback — any non-`/api`, non-`/photos` route returns `index.html` so
client-side routes deep-link cleanly, while unknown `/api/*` paths still return a
JSON 404 (the SPA never shadows the API). Point the server at a build with
`CLIENT_DIR`; by default it serves `dist/ui` if that directory exists.

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

Environment:

- `DATA_DIR` — path to the data working clone. Unset ⇒ demo mode.
- `SESSION_SECRET` — required outside demo; signs session cookies.
- `OWNER_USERNAME` / `OWNER_PASSWORD` — seed the first owner on an empty store.
- `USERS_PATH` — users store location (default `./var/users.json`; never in the
  data repo; gitignored).
- `PORT` (default 8080), `COOKIE_SECURE` (default true; set `false` for local http).

## Write API (P1c)

Authenticated writes are committed to the local data working clone — one commit
per change, authored as the logged-in user. Two-way sync (`pull`/`push`) is P2;
P1c commits locally only. If `DATA_DIR` is not a git repo, writes still persist
to disk but are not committed (a warning is logged at boot).

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
  streaming + built-SPA serving with history-fallback), `routes/` (auth, data,
  admin, writes), `app` (`createApp` factory), `index` (boot). Imports the data
  layer only from `src/data/index.ts`.
- `src/ui/` — the SPA (Vite + React 18 + TS): `main.tsx` (React 18 `createRoot`),
  `App.tsx` → `AppRouter.tsx` (session + router + shell), `lib/` (`api.ts` typed
  fetch client, `types.ts` type-only record re-exports, `format.ts` formatters),
  `state/session.tsx` (auth/role context), `components/` (`Shell.tsx`, `Icon.tsx`,
  `atoms.tsx`), `pages/` (one component per page), `styles/app.css` (the design
  system, ported from the prototype), `vite.config.ts` (root `src/ui`, builds to
  `dist/ui`, dev proxy to :8080), `index.html`, and `test/setup.ts` (jest-dom for
  the jsdom suite).
- `test/data/` — Vitest unit tests for the data layer.
- `test/server/` — Vitest + supertest tests for the server (auth, reads, redaction,
  admin, demo, writes, store, git, photos, static photo/SPA serving).
- UI tests live next to the code as `src/ui/**/*.test.tsx`; `vitest.config.ts`
  runs them as a second jsdom project alongside the node server/data project.
- `demo/` — a sample "Valkyrie" dataset used by tests and demo mode.
- `docs/` — design spec, implementation plans, and the `prototype/` design source.
