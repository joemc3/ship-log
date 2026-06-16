# Ship's Log

A reusable, git-backed, self-hostable boat-management hub. Fork it, point it at
your own boat's data repo, and go. See the design spec in
`docs/superpowers/specs/2026-06-14-ship-log-design.md`.

## Status

In development. The data core (P1a), the read server (P1b), and the write layer
(P1c) are built: a headless data layer (`src/data/`) plus an Express REST API
(`src/server/`) with app-level auth (signed-cookie sessions, three roles),
server-side cost redaction, record writes committed to the local data repo, and
photo upload. Two-way git sync (P2) and the SPA (P1d) follow in later plans.

## Develop

```bash
npm install
npm test            # run the suite once
npm run test:watch  # watch mode
npm run typecheck   # tsc --noEmit
```

## Run the server

```bash
npm start          # production-style boot (tsx)
npm run dev        # watch mode
```

With no `DATA_DIR` the server runs in **demo mode**: it serves the bundled
`demo/` dataset read-only, with no auth and costs visible, clearly flagged via
`GET /api/me` (`demo: true`).

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
  (local commit), `photos` (`sharp` compression), `routes/` (auth, data, admin,
  writes), `app` (`createApp` factory), `index` (boot). Imports the data layer
  only from `src/data/index.ts`.
- `test/data/` — Vitest unit tests for the data layer.
- `test/server/` — Vitest + supertest tests for the server (auth, reads, redaction,
  admin, demo, writes, store, git, photos).
- `demo/` — a sample "Valkyrie" dataset used by tests and demo mode.
- `docs/` — design spec and implementation plans.
