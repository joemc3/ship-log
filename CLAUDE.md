# CLAUDE.md — Ship's Log conventions

Project rules and conventions. Grown as we build. See the design spec at
`docs/superpowers/specs/2026-06-14-ship-log-design.md`.

## Doc-upkeep rule (required)

Every change MUST verify that `README.md` and this `CLAUDE.md` are still accurate
and update them if not. Treat "are README.md and CLAUDE.md still correct?" as part
of finishing any change, before claiming it done.

## Stack & layout

- TypeScript, ESM, Node 20+. Test with Vitest (`npm test`).
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
