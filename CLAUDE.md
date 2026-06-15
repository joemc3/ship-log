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

- `src/server/` is the read API: one responsibility per file; it imports the data
  layer **only** from `src/data/index.ts`. The app is a `createApp(deps)` factory
  with injected `{config, dataset, users, now}` — tests drive it via `supertest`
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
