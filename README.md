# Ship's Log

A reusable, git-backed, self-hostable boat-management hub. Fork it, point it at
your own boat's data repo, and go. See the design spec in
`docs/superpowers/specs/2026-06-14-ship-log-design.md`.

## Status

In development. The data core (P1a) and the read server (P1b) are built: a
headless data layer (`src/data/`) plus an Express REST API (`src/server/`) with
app-level auth (signed-cookie sessions, three roles) and server-side cost
redaction. Record writes, git sync, photos, and the SPA follow in later plans.

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

## Layout

- `src/data/` — the data layer: `record` (frontmatter parse/serialize), `schema`
  (Zod schemas + types), `monetary` (cost-field registry), `dataset` (load a data
  dir), `links` (cross-link integrity), `derive` (inventory tasks + attention),
  `search`. Public API is `src/data/index.ts`.
- `src/server/` — the read server: `config`, `session`, `users` (argon2id store),
  `redact` (role-scoped dataset view), `middleware`, `routes/` (auth, data,
  admin), `app` (`createApp` factory), `index` (boot). Imports the data layer
  only from `src/data/index.ts`.
- `test/data/` — Vitest unit tests for the data layer.
- `demo/` — a sample "Valkyrie" dataset used by tests and demo mode.
- `docs/` — design spec and implementation plans.
