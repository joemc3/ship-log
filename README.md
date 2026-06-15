# Ship's Log

A reusable, git-backed, self-hostable boat-management hub. Fork it, point it at
your own boat's data repo, and go. See the design spec in
`docs/superpowers/specs/2026-06-14-ship-log-design.md`.

## Status

In development. Phase P1a (data core) is the first deliverable: a headless,
unit-tested data layer (`src/data/`). The server, auth, and UI follow in later
plans.

## Develop

```bash
npm install
npm test            # run the suite once
npm run test:watch  # watch mode
npm run typecheck   # tsc --noEmit
```

## Layout

- `src/data/` — the data layer: `record` (frontmatter parse/serialize), `schema`
  (Zod schemas + types), `monetary` (cost-field registry), `dataset` (load a data
  dir), `links` (cross-link integrity), `derive` (inventory tasks + attention),
  `search`. Public API is `src/data/index.ts`.
- `test/data/` — Vitest unit tests for the data layer.
- `demo/` — a sample "Valkyrie" dataset used by tests and demo mode.
- `docs/` — design spec and implementation plans.
