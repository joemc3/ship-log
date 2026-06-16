# Ship's Log — P1c: record writes + write queue + local git commit + photo upload — Design

**Date:** 2026-06-16
**Status:** Approved (design phase)
**Author:** Joe McCormick (with Claude)
**Parent spec:** `docs/superpowers/specs/2026-06-14-ship-log-design.md`

## Goal

Add the **write path** to the Ship's Log server. Today the app is read-only:
`loadDataset()` parses the data repo into memory and the server serves role-scoped
reads. P1c makes the data editable through the API — create/edit/delete records,
mark maintenance complete, upload photos — with every change committed to the
local working clone as a versioned logbook entry.

This is the third slice of P1 (P1a data core ✓, P1b read server ✓). It is
independently valuable and testable against a throwaway local git repo with no
network.

## Scope

**In scope**

- Record writes: `POST`/`PUT`/`DELETE` for the record collections (trips,
  maintenance, inventory, vendors, costs, manuals), validated against the existing
  schemas before any disk or git operation.
- A **single serialized writer**: all mutations run through an in-process serial
  queue so the server is the only writer and writes never interleave.
- **Local git commit** per write: `git add` + `commit` to the working clone,
  authored as the logged-in user (fallback to a generic app identity).
- **Photo upload**: multipart upload → validate → compress (`sharp`) to a
  size/dimension budget → store in `photos/` → return a repo-relative reference.
- The **crew write scope** from the parent spec: crew may create/edit trips and
  mark a maintenance item complete; everything else is owner-only.
- **Redaction-on-write**: write responses pass through the same role redaction as
  reads, so monetary values never escape a crew/guest response.

**Out of scope (deferred to P2 with deployment)**

- `pull --rebase`, `push`, the sync scheduler, conflict surfacing, and remote
  credentials. P1c commits locally only.
- Any UI (the SPA is P1d).
- New monetary fields (the `monetary.ts` registry is unchanged this slice).
- Editing the `boat.yaml` and `quickref.yaml` singletons. P1c writes only the six
  per-record collections in `collectionSchemas` (trips, maintenance, inventory,
  vendors, costs, manuals). The singletons are whole-file YAML config, a different
  write shape, and are deferred.

## Architecture

### The dataset-refresh decision

The dataset is loaded once at boot and held in memory. After a write, the
in-memory copy must reflect the change. We use a **stateful `ShipStore`** that owns
the dataset snapshot, a serial write queue, and the git client. A write runs
`validate → write file → commit → reload-from-disk → atomic snapshot swap`; reads
call `store.current()`.

- Reload re-validates from the source of truth (disk), so memory can never drift
  from the serialized form.
- The atomic snapshot swap means a read concurrent with a write sees either the
  whole old dataset or the whole new one — never a torn, half-updated view.
- Full reload per write is free at this scale (one boat's worth of files).

Rejected alternatives: **in-place mutation** of the injected dataset (torn reads;
hand-maintained consistency) and **no cache / read-per-request** (re-validates
everything every request; abandons the load-once design).

### New units (one responsibility each)

| Unit | Responsibility | Depends on |
|---|---|---|
| **`src/data/write.ts`** (data layer, pure; exported via `index.ts`) | Record↔file helpers: split body from frontmatter and serialize (reusing `serializeRecord`); `recordPath(collection, id)`; **ID derivation** — `t-YYYY-MM-DD` from a trip's date with collision suffixing, `<prefix>-<slug>` from a title/name. Validation reuses `collectionSchemas`. | `record.ts`, `schema.ts` |
| **`src/server/git.ts`** | Thin `simple-git` wrapper: `isRepo()`, `commitAll(message, author)`. | `simple-git`, working clone |
| **`src/server/photos.ts`** | `sharp` pipeline: validate mime/size; compress to budget (resize longest edge ~2048px, re-encode JPEG ~200–500 KB); return `{bytes, ext}`. | `sharp` |
| **`src/server/store.ts`** (`ShipStore`) | Owns the dataset snapshot + a serial promise-queue + the git client + `reload()`. Methods: `current()`, `createRecord`, `updateRecord`, `deleteRecord`, `completeMaintenance`, `savePhoto`. Imports the data layer only via `src/data/index.ts`. | data layer (`index.ts`), `git.ts`, `photos.ts` |
| **`src/server/routes/writes.ts`** | The POST/PUT/DELETE routes — role guards + `denyInDemo`, call store methods, redact responses. | `ShipStore`, middleware, `redact.ts` |

**Wiring change:** `AppContext.dataset: Dataset` becomes `AppContext.store:
ShipStore`. `app.ts`, `routes/data.ts`, and `src/server/index.ts` read
`store.current()`; the entry point builds `await ShipStore.open(config.dataDir)`.

**New dependencies:** `simple-git`, `sharp`, `multer` (memory storage) + `@types/multer`.

## Routes & authorization

The dividing line is exactly the existing middleware — `requireAuth` (crew+owner)
vs `requireOwner` — plus `denyInDemo` on **every** write route.

| Route | Who | Notes |
|---|---|---|
| `POST /api/trips`, `PUT /api/trips/:id` | crew + owner | create/edit trips; partial-but-valid (free-text-only) accepted |
| `POST /api/maintenance/:id/complete` | crew + owner | **dedicated narrow op**: `status → done`, set `completed`, optional note appended to body |
| `POST` / `PUT` `/api/{maintenance,inventory,vendors,costs,manuals}` | owner only | full create/edit |
| `DELETE /api/{collection}/:id` | owner only | |
| `POST /api/photos` | crew + owner | multipart → compressed, stored, returns `{ ref }` |

A **dedicated `/complete` endpoint** (not a field-filtered shared PUT) keeps the
authorization crisp: crew cannot reach a code path that edits `costEst` or any
other field. `completeMaintenance` sets `status='done'` and `completed` (defaults
to the injected clock's today), appends an optional note to the body, and touches
nothing else.

## Write path & redaction-on-write

```
authorize (role)
  → denyInDemo
  → validate body (zod via collectionSchemas; 400 BEFORE any disk/git)
  → enqueue {
       derive id (collision-safe, creates only)
       → serialize record to file
       → writeFile
       → git add + commit  (author = logged-in user; fallback app identity)
       → reload + atomic snapshot swap
     }
  → return the saved record, REDACTED BY ROLE  (201 create / 200 update)
```

- **Update / complete / delete** resolve the existing record from `current()` first
  (404 if absent), then merge/serialize/commit/reload on the same queue.
- **Photo upload** validates and compresses up front, then enqueues the file write
  + commit; it does not touch the dataset (photos aren't records), so no reload.
- **Redaction-on-write (security invariant):** every write response goes through
  the same role redaction as reads. A crew member completing a maintenance item
  that carries a `costEst` never sees the value echoed back. The `redaction-golden`
  test is **extended to cover write responses**. No new monetary fields are added
  this slice, so `monetary.ts` is unchanged.

## Error handling

- Out-of-scope write (e.g. crew → costs, or crew → full maintenance PUT) → **403**
  at the role guard, before validation.
- Invalid body → **400** (zod), before any disk or git operation.
- Unknown id on PUT/DELETE/complete → **404**.
- Photo too large / unsupported type → **413/415**, before compression. A record
  write only stores the reference string, so a record never references a photo that
  failed to store.
- Git failure → **500**, logged. Realistic only when the data dir isn't a repo,
  which is detected at boot.
- **Non-repo data dir:** `ShipStore.open` detects it, logs a clear warning, and
  runs in *persist-without-commit* mode — files are still written and the dataset
  still refreshes, so local scratch dirs stay usable. The deployed working clone is
  always a repo and always commits.
- **Demo mode** → **403** ("disabled in demo mode") on every write route.
- The serial queue guarantees a single writer; writes never interleave.

## Testing strategy

TDD, unit-first (Vitest + supertest, in-process).

- **Authorization & scope:** crew can create/edit a trip and complete a maintenance
  item; crew gets **403 on everything else** (cost/vendor/inventory/manual writes,
  any DELETE, full maintenance PUT); the crew complete-response has `costEst`
  stripped. Owner has full CRUD across collections.
- **Demo:** `denyInDemo` returns 403 on every write route.
- **Validation:** invalid body → 400 *before* any file is written; partial-but-valid
  trip (free-text-only) accepted.
- **ID derivation:** trip date-collision suffixing; slug-collision suffixing.
- **Round-trip & refresh:** a GET after a POST/PUT sees the change; reload swaps the
  in-memory snapshot.
- **Write queue:** concurrent writes serialize with no lost update or interleave.
- **Git layer:** against a temp `git init` repo, one commit per write with the right
  author and message; a non-repo dir takes the persist-without-commit path and warns.
- **Photo layer:** compression meets the size/dimension budget; oversized/unsupported
  rejected; the returned ref resolves to a stored file.
- **Redaction-golden (extended):** no monetary key appears in any crew/guest **write**
  response, across every write route.

## Doc-upkeep (required by CLAUDE.md)

This change updates:

- **`README.md`** — the new write endpoints, the photo upload, and the new
  dependencies (`simple-git`, `sharp`, `multer`).
- **`CLAUDE.md`** — a P1c section covering the `ShipStore` (snapshot + serial queue
  + reload-and-swap), the git layer (local commit; non-repo persist-without-commit),
  the photo layer, the crew write scope, and the redaction-on-write extension of the
  invariant.

## Risks / open questions

- **File-written-but-commit-failed** edge (local single repo): rare — the only
  realistic trigger (non-repo dir) is handled by the persist-without-commit path.
  Not worth file-rollback machinery at this scale; a failed git op is logged.
- **`sharp` native binary** adds a platform-specific dependency; acceptable (it is
  the standard Node image pipeline and ships prebuilt binaries).
- **No remote yet** — P1c is local-commit-only by design; push/pull/conflict/sync
  arrive in P2 with deployment, where the credential and remote exist.
