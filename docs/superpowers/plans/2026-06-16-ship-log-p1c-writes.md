# Ship's Log — P1c: Record Writes + Write Queue + Local Git Commit + Photo Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the **write path** to the Ship's Log server — create/edit/delete records, mark maintenance complete, and upload photos — with every change validated, serialized through a single-writer queue, and committed to the **local** data working clone. No remote sync yet (pull/push/conflicts are P2); no SPA (P1d).

**Architecture:** A stateful **`ShipStore`** (`src/server/store.ts`) owns the in-memory dataset snapshot, a serial write queue, and a `simple-git` client. Every mutation runs `validate → write file → commit → reload-from-disk → atomic snapshot swap`; reads call `store.current()`, so a read never sees a torn dataset and the snapshot can't drift from the serialized form. `createApp` is threaded with `store` in place of the raw `dataset`. Pure record↔file helpers and server-side id derivation live in the data layer (`src/data/write.ts`); git and photo (`sharp`) concerns are thin server-side units. Write responses are role-redacted exactly like reads.

**Tech Stack:** TypeScript (ESM, Node 20+), Vitest + supertest, Express 5, `simple-git` (local commit), `sharp` (image compression), `multer` (multipart, memory storage), Zod (existing schemas).

---

## File Structure

```
ship-log/  (= repo root, /Users/joemc3/tmp/sailing)
  src/data/
    write.ts           # NEW: record↔file + server-side id derivation (pure)
    index.ts           # MODIFY: export ./write.js
  src/server/
    git.ts             # NEW: simple-git wrapper (isRepo + commitAll); local-only
    photos.ts          # NEW: sharp compression + type/size validation
    store.ts           # NEW: ShipStore — snapshot + serial queue + git + reload
    redact.ts          # MODIFY: add redactRecord(collection, record, role)
    routes/writes.ts   # NEW: POST/PUT/DELETE routes + photo upload
    app.ts             # MODIFY: AppContext.dataset -> store; wire write routes
    routes/data.ts     # MODIFY: read via store.current()
    routes/auth.ts     # MODIFY: /api/welcome via store.current().boat
    index.ts           # MODIFY: build ShipStore.open(dataDir)
  test/data/
    write.test.ts      # NEW
  test/server/
    helpers.ts         # MODIFY: makeDataRepo() + buildTestApp builds a store
    git.test.ts        # NEW
    photos.test.ts     # NEW
    store.test.ts      # NEW
    writes.test.ts     # NEW
    redaction-golden.test.ts  # MODIFY: cover write responses
  README.md            # MODIFY (doc-upkeep)
  CLAUDE.md            # MODIFY (doc-upkeep)
```

One responsibility per file. `write.ts` is pure data-layer (no IO); `git.ts`/`photos.ts` are thin infra; `store.ts` orchestrates; `routes/writes.ts` is HTTP-only.

---

### Task 1: Add P1c dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the runtime + type dependencies**

```bash
cd /Users/joemc3/tmp/sailing
npm install simple-git sharp multer
npm install -D @types/multer
```
Expected: `simple-git`, `sharp`, `multer` appear under `dependencies`; `@types/multer` under `devDependencies`. `sharp` installs a prebuilt platform binary (no source compile on common platforms). `simple-git` and `sharp` bundle their own types; `multer` needs `@types/multer`.

- [ ] **Step 2: Verify the toolchain still typechecks and tests still pass**

Run: `npm run typecheck && npm test`
Expected: no TypeScript errors; the existing P1a/P1b suite is fully green (the new deps are not imported yet).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add simple-git, sharp, multer for P1c writes"
```

---

### Task 2: Data-layer write helpers (`src/data/write.ts`)

Pure helpers: record↔file serialization, repo-relative paths, and **server-side id derivation** (`t-<date>` for trips; `<prefix>-<slug>` from title/name/item otherwise, with collision suffixes). No filesystem or git — just transforms. Validation reuses the existing schemas; `createSchemas` is each record schema minus `id` (the server assigns it).

**Files:**
- Create: `src/data/write.ts`
- Modify: `src/data/index.ts`
- Test: `test/data/write.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/data/write.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  recordPath, slugify, deriveId, toFileContents, createSchemas, parseRecord,
} from '../../src/data/index.js';

describe('recordPath', () => {
  it('maps a collection + id to its repo-relative file path', () => {
    expect(recordPath('trip', 't-2024-06-22')).toBe('trips/t-2024-06-22.md');
    expect(recordPath('maintenance', 'm-jib')).toBe('maintenance/m-jib.md');
    expect(recordPath('cost', 'c-x')).toBe('costs/c-x.md');
    expect(recordPath('vendor', 'v-x')).toBe('vendors/v-x.md');
    expect(recordPath('inventory', 'inv-x')).toBe('inventory/inv-x.md');
    expect(recordPath('manual', 'man-x')).toBe('manuals/man-x.md');
  });
});

describe('slugify', () => {
  it('lowercases, hyphenates, and strips punctuation', () => {
    expect(slugify('Replace Frayed Jib Halyard')).toBe('replace-frayed-jib-halyard');
    expect(slugify('  Engine  Oil & Filter!! ')).toBe('engine-oil-filter');
    expect(slugify('***')).toBe('');
  });
});

describe('deriveId', () => {
  it('derives a trip id from its date, suffixing on collision', () => {
    expect(deriveId('trip', { date: '2024-07-01' }, new Set())).toBe('t-2024-07-01');
    const taken = new Set(['t-2024-06-22']);
    expect(deriveId('trip', { date: '2024-06-22' }, taken)).toBe('t-2024-06-22-2');
    taken.add('t-2024-06-22-2');
    expect(deriveId('trip', { date: '2024-06-22' }, taken)).toBe('t-2024-06-22-3');
  });

  it('derives a slug id from the right source field per collection', () => {
    expect(deriveId('maintenance', { title: 'Replace Jib Halyard' }, new Set())).toBe('m-replace-jib-halyard');
    expect(deriveId('vendor', { name: 'Sail Loft' }, new Set())).toBe('v-sail-loft');
    expect(deriveId('inventory', { name: 'Flares' }, new Set())).toBe('inv-flares');
    expect(deriveId('cost', { item: 'New Halyard' }, new Set())).toBe('c-new-halyard');
    expect(deriveId('manual', { title: 'Engine' }, new Set())).toBe('man-engine');
  });

  it('suffixes a slug id on collision', () => {
    expect(deriveId('vendor', { name: 'Sail Loft' }, new Set(['v-sail-loft']))).toBe('v-sail-loft-2');
  });

  it('throws when a non-trip source slugs to empty', () => {
    expect(() => deriveId('vendor', { name: '***' }, new Set())).toThrow();
  });
});

describe('toFileContents', () => {
  it('round-trips: body is excluded from frontmatter and restored on parse', () => {
    const file = toFileContents({ id: 't-2024-07-01', date: '2024-07-01', title: 'Sail', body: 'Lovely day.' });
    const { data, body } = parseRecord(file);
    expect(data).toEqual({ id: 't-2024-07-01', date: '2024-07-01', title: 'Sail' });
    expect(body).toBe('Lovely day.');
    expect(file).not.toContain('body:'); // body must never leak into YAML frontmatter
  });
});

describe('createSchemas', () => {
  it('validates create input without requiring an id', () => {
    expect(createSchemas.trip.safeParse({ date: '2024-07-01' }).success).toBe(true);
    expect(createSchemas.trip.safeParse({ date: 'nope' }).success).toBe(false);
    expect(createSchemas.vendor.safeParse({ name: 'Sail Loft' }).success).toBe(true);
    expect(createSchemas.vendor.safeParse({}).success).toBe(false); // name required
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- write`
Expected: FAIL — cannot resolve `recordPath`/`deriveId`/… from `src/data/index.js`.

- [ ] **Step 3: Write the implementation**

Create `src/data/write.ts`:
```ts
import { serializeRecord } from './record.js';
import {
  collectionSchemas,
  tripSchema, maintenanceSchema, costSchema, vendorSchema, inventorySchema, manualSchema,
} from './schema.js';
import type { Dataset } from './dataset.js';

/** The per-record collections (singular keys of `collectionSchemas`). */
export type CollectionName = keyof typeof collectionSchemas;

/**
 * Collection (singular) → its on-disk directory. That directory name is ALSO the
 * Dataset array key and the REST path segment (trips, maintenance, costs, …), so
 * this is the one source of truth for all three.
 */
export const COLLECTION_DIR = {
  trip: 'trips',
  maintenance: 'maintenance',
  cost: 'costs',
  vendor: 'vendors',
  inventory: 'inventory',
  manual: 'manuals',
} as const satisfies Record<CollectionName, keyof Dataset>;

/**
 * Per-collection schema for CREATE input: the full record schema minus `id`
 * (the server derives the id). Defined on the concrete schemas so it typechecks.
 */
export const createSchemas = {
  trip: tripSchema.omit({ id: true }),
  maintenance: maintenanceSchema.omit({ id: true }),
  cost: costSchema.omit({ id: true }),
  vendor: vendorSchema.omit({ id: true }),
  inventory: inventorySchema.omit({ id: true }),
  manual: manualSchema.omit({ id: true }),
} as const;

/** Repo-relative path for a record file, e.g. ('trip','t-2024-06-22') → 'trips/t-2024-06-22.md'. */
export function recordPath(collection: CollectionName, id: string): string {
  return `${COLLECTION_DIR[collection]}/${id}.md`;
}

/** Lowercase slug: whitespace/underscores → '-', drop non [a-z0-9-], collapse and
 *  trim hyphens. Returns '' when nothing usable remains. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// The field each non-trip collection slugs its id from.
const SLUG_SOURCE: Record<Exclude<CollectionName, 'trip'>, string> = {
  maintenance: 'title',
  cost: 'item',
  vendor: 'name',
  inventory: 'name',
  manual: 'title',
};

const ID_PREFIX: Record<Exclude<CollectionName, 'trip'>, string> = {
  maintenance: 'm-',
  cost: 'c-',
  vendor: 'v-',
  inventory: 'inv-',
  manual: 'man-',
};

/** Append -2, -3, … to `base` until it is free of `taken`. */
function uniquify(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Derive a human-readable, collision-free id from validated create input.
 * Trips: `t-<date>` (then `-2`, `-3`…). Others: `<prefix><slug-of-source>`.
 * Throws if a non-trip source slugs to empty (the caller maps that to a 400).
 */
export function deriveId(
  collection: CollectionName,
  input: Record<string, unknown>,
  taken: Set<string>,
): string {
  if (collection === 'trip') {
    return uniquify(`t-${String(input.date)}`, taken);
  }
  const source = String(input[SLUG_SOURCE[collection]] ?? '');
  const slug = slugify(source);
  if (!slug) {
    throw new Error(`cannot derive id: ${collection} needs a non-empty ${SLUG_SOURCE[collection]}`);
  }
  return uniquify(`${ID_PREFIX[collection]}${slug}`, taken);
}

/** Serialize a record (frontmatter fields + `body`) to Markdown file contents.
 *  `body` is pulled out of the object so it never lands in the YAML frontmatter. */
export function toFileContents(record: Record<string, unknown> & { body?: string }): string {
  const { body = '', ...data } = record;
  return serializeRecord(data, body);
}
```

- [ ] **Step 4: Export the new module (modify `src/data/index.ts`)**

Append after the existing `export * from './search.js';` line:
```ts
export * from './write.js';
```

- [ ] **Step 5: Run test + typecheck**

Run: `npm test -- write && npm run typecheck`
Expected: PASS (6 describe blocks); typecheck clean. (If `noUncheckedIndexedAccess` flags anything, note that `COLLECTION_DIR`/`createSchemas`/`SLUG_SOURCE`/`ID_PREFIX` are object literals with known keys — accessing them with `CollectionName` does NOT add `undefined`.)

- [ ] **Step 6: Commit**

```bash
git add src/data/write.ts src/data/index.ts test/data/write.test.ts
git commit -m "feat(data): record↔file helpers + server-side id derivation"
```

---

### Task 3: Git wrapper (`src/server/git.ts`)

A thin `simple-git` wrapper for **local** commits only. If the data dir is not a git repo, the wrapper is *disabled* and `commitAll` is a no-op so writes still persist files (persist-without-commit).

**Files:**
- Create: `src/server/git.ts`
- Test: `test/server/git.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/server/git.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { GitRepo } from '../../src/server/git.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'shiplog-git-'));
}

async function initRepo(dir: string): Promise<void> {
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@shiplog.test');
  await git.addConfig('user.name', 'Test');
}

describe('GitRepo', () => {
  it('commits staged changes as the given author in a real repo', async () => {
    const dir = tmpDir();
    await initRepo(dir);
    writeFileSync(join(dir, 'a.md'), 'hello');
    const repo = await GitRepo.open(dir);
    expect(repo.enabled).toBe(true);
    const sha = await repo.commitAll('add a', { name: 'Cap', email: 'cap@boat.test' });
    expect(sha).toBeTruthy();
    const line = (await simpleGit(dir).raw(['log', '-1', '--format=%an|%s'])).trim();
    expect(line).toBe('Cap|add a');
  });

  it('stages new files AND deletions', async () => {
    const dir = tmpDir();
    await initRepo(dir);
    writeFileSync(join(dir, 'a.md'), 'one');
    const repo = await GitRepo.open(dir);
    await repo.commitAll('add a', { name: 'Cap', email: 'cap@boat.test' });
    rmSync(join(dir, 'a.md'));
    writeFileSync(join(dir, 'b.md'), 'two');
    const sha = await repo.commitAll('swap a for b', { name: 'Cap', email: 'cap@boat.test' });
    expect(sha).toBeTruthy();
    const files = (await simpleGit(dir).raw(['ls-files'])).trim();
    expect(files).toBe('b.md');
  });

  it('is disabled (no-op commit) when the dir is not a git repo', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'a.md'), 'hello');
    const repo = await GitRepo.open(dir);
    expect(repo.enabled).toBe(false);
    expect(await repo.commitAll('noop', { name: 'X', email: 'x@x' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- git`
Expected: FAIL — cannot resolve `src/server/git.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/git.ts`:
```ts
import { simpleGit, type SimpleGit } from 'simple-git';

export interface CommitAuthor {
  name: string;
  email: string;
}

/**
 * Thin wrapper over the local git working clone. P1c commits LOCALLY only —
 * pull/push/sync are P2. If `dir` is not a git repo, the wrapper is DISABLED and
 * `commitAll` is a no-op, so writes still persist files (persist-without-commit).
 */
export class GitRepo {
  private constructor(
    private readonly git: SimpleGit,
    readonly enabled: boolean,
  ) {}

  static async open(dir: string): Promise<GitRepo> {
    const git = simpleGit(dir);
    let enabled = false;
    try {
      enabled = await git.checkIsRepo();
    } catch {
      enabled = false;
    }
    return new GitRepo(git, enabled);
  }

  /** Stage everything under the working clone and commit as `author`. Returns the
   *  new commit hash, or null when disabled (the dir is not a git repo). */
  async commitAll(message: string, author: CommitAuthor): Promise<string | null> {
    if (!this.enabled) return null;
    await this.git.add('.');
    const res = await this.git.commit(message, { '--author': `${author.name} <${author.email}>` });
    return res.commit || null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- git`
Expected: PASS (3 tests). (`commitAll` relies on a committer identity from local/global git config; the test sets it via `initRepo`. A deployed working clone inherits the user's global git identity; the per-commit `--author` is the logged-in app user.)

- [ ] **Step 5: Commit**

```bash
git add src/server/git.ts test/server/git.test.ts
git commit -m "feat(server): simple-git wrapper for local commits (persist-without-commit when no repo)"
```

---

### Task 4: Photo pipeline (`src/server/photos.ts`)

Validate upload type/size, then compress with `sharp` to a size/dimension budget. Content-addressed file names keep tests deterministic and dedupe identical images.

**Files:**
- Create: `src/server/photos.ts`
- Test: `test/server/photos.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/server/photos.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { compressPhoto, photoName, PhotoError } from '../../src/server/photos.js';

function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 80, b: 160 } } }).png().toBuffer();
}

describe('compressPhoto', () => {
  it('resizes within the budget and re-encodes as jpeg', async () => {
    const big = await makePng(4000, 3000);
    const out = await compressPhoto(big, 'image/png');
    expect(out.ext).toBe('jpg');
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2048);
  });

  it('rejects an unsupported mime type with 415', async () => {
    await expect(compressPhoto(Buffer.from('x'), 'image/gif')).rejects.toBeInstanceOf(PhotoError);
    await expect(compressPhoto(Buffer.from('x'), 'image/gif')).rejects.toMatchObject({ status: 415 });
  });

  it('rejects an oversized upload with 413 BEFORE decoding', async () => {
    const huge = Buffer.alloc(26 * 1024 * 1024, 1); // size checked before sharp touches it
    await expect(compressPhoto(huge, 'image/jpeg')).rejects.toMatchObject({ status: 413 });
  });
});

describe('photoName', () => {
  it('is deterministic for identical bytes and ends in .jpg', () => {
    expect(photoName(Buffer.from('same'))).toBe(photoName(Buffer.from('same')));
    expect(photoName(Buffer.from('same'))).toMatch(/^[0-9a-f]{12}\.jpg$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- photos`
Expected: FAIL — cannot resolve `src/server/photos.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/photos.ts`:
```ts
import sharp from 'sharp';
import { createHash } from 'node:crypto';

const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // reject before decoding
const MAX_EDGE = 2048;                      // longest-edge budget
const JPEG_QUALITY = 80;

/** A photo-pipeline failure the caller maps to an HTTP status (415 | 413). */
export class PhotoError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PhotoError';
  }
}

export interface CompressedPhoto {
  bytes: Buffer;
  ext: 'jpg';
}

/** Validate type/size, then compress to budget (resize longest edge to MAX_EDGE,
 *  re-encode JPEG). Throws PhotoError(415|413) on bad input. */
export async function compressPhoto(buf: Buffer, mime: string): Promise<CompressedPhoto> {
  if (!ACCEPTED_MIME.has(mime)) throw new PhotoError(`unsupported image type: ${mime}`, 415);
  if (buf.length > MAX_UPLOAD_BYTES) throw new PhotoError('image exceeds the upload size limit', 413);
  const bytes = await sharp(buf)
    .rotate() // honor EXIF orientation before resizing
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return { bytes, ext: 'jpg' };
}

/** Content-addressed file name: stable for identical bytes (deterministic tests +
 *  natural dedupe). Returns just the name; the caller prefixes `photos/`. */
export function photoName(bytes: Buffer): string {
  return `${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.jpg`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- photos`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/photos.ts test/server/photos.test.ts
git commit -m "feat(server): sharp photo compression + type/size validation"
```

---

### Task 5: `ShipStore` — the single serialized writer

The core unit. Owns the in-memory dataset snapshot, a serial write queue, and the git client. Each mutation runs `validate → write file → commit → reload → swap`. The store does **not** redact — it returns full records; the route boundary redacts (Task 7), which is what proves redaction is enforced there.

**Files:**
- Create: `src/server/store.ts`
- Modify: `test/server/helpers.ts` (add the `makeDataRepo` helper)
- Test: `test/server/store.test.ts`

- [ ] **Step 1: Add the throwaway-data-repo helper (modify `test/server/helpers.ts`)**

Add these imports at the top of `test/server/helpers.ts` (beside the existing imports):
```ts
import { cp } from 'node:fs/promises';
import { simpleGit } from 'simple-git';
```
And append this exported function to the end of the file:
```ts
/** Copy the demo dataset into a fresh temp dir and git-init it, so write tests
 *  commit into a throwaway repo (never the app repo). Returns the dir path. */
export async function makeDataRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'shiplog-data-'));
  await cp(DEMO, dir, { recursive: true });
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@shiplog.test');
  await git.addConfig('user.name', 'Test');
  await git.add('.');
  await git.commit('seed demo dataset');
  return dir;
}
```
(`mkdtempSync`, `tmpdir`, `join`, `DEMO` are already imported/defined in `helpers.ts` from P1b. `buildTestApp` is untouched in this task.)

- [ ] **Step 2: Write the failing test**

Create `test/server/store.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import sharp from 'sharp';
import { ShipStore } from '../../src/server/store.js';
import { makeDataRepo } from './helpers.js';

const NOW = () => new Date('2024-07-01T00:00:00Z');
const AUTHOR = { name: 'Cap', email: 'cap@boat.test' };

describe('ShipStore', () => {
  it('creates a record, commits it, and reflects it in current()', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const rec = await store.createRecord('vendor', { name: 'Rigging Pros', phone: '555' }, 'Great service.', AUTHOR);
    expect(rec.id).toBe('v-rigging-pros');
    expect(store.current().vendors.some((v) => v.id === 'v-rigging-pros')).toBe(true);
    const line = (await simpleGit(dir).raw(['log', '-1', '--format=%an|%s'])).trim();
    expect(line).toBe('Cap|add vendor v-rigging-pros');
  });

  it('derives a trip id from its date and suffixes a same-date collision', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const a = await store.createRecord('trip', { date: '2024-08-01' }, 'first', AUTHOR);
    const b = await store.createRecord('trip', { date: '2024-08-01' }, 'second', AUTHOR);
    expect(a.id).toBe('t-2024-08-01');
    expect(b.id).toBe('t-2024-08-01-2');
  });

  it('rejects an invalid create with 400 and writes nothing', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const before = store.current().trips.length;
    await expect(store.createRecord('trip', { date: 'someday' }, '', AUTHOR)).rejects.toMatchObject({ status: 400 });
    expect(store.current().trips.length).toBe(before);
  });

  it('updates a record and 404s an unknown id', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const rec = await store.updateRecord('trip', 't-2024-06-22', { title: 'Renamed', body: 'New narrative.' }, AUTHOR);
    expect(rec.title).toBe('Renamed');
    expect(rec.body).toBe('New narrative.');
    await expect(store.updateRecord('trip', 't-nope', { title: 'x' }, AUTHOR)).rejects.toMatchObject({ status: 404 });
  });

  it('marks maintenance complete, defaulting the date to today; store does NOT redact', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const rec = await store.completeMaintenance('m-jib-halyard', { note: 'New halyard run.' }, AUTHOR);
    expect(rec.status).toBe('done');
    expect(rec.completed).toBe('2024-07-01'); // from NOW
    expect(rec.costEst).toBe(95);             // unredacted at the store layer
    expect(String(rec.body)).toContain('## Completed 2024-07-01');
    expect(String(rec.body)).toContain('New halyard run.');
  });

  it('deletes a record and commits the removal', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    await store.deleteRecord('trip', 't-2024-06-22', AUTHOR);
    expect(store.current().trips.some((t) => t.id === 't-2024-06-22')).toBe(false);
    expect((await simpleGit(dir).raw(['ls-files', 'trips'])).trim()).toBe('');
  });

  it('serializes concurrent writes (single writer, unique ids)', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const [a, b, c] = await Promise.all([
      store.createRecord('trip', { date: '2024-09-01' }, 'a', AUTHOR),
      store.createRecord('trip', { date: '2024-09-01' }, 'b', AUTHOR),
      store.createRecord('trip', { date: '2024-09-01' }, 'c', AUTHOR),
    ]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(store.current().trips.filter((t) => t.id.startsWith('t-2024-09-01')).length).toBe(3);
  });

  it('saves a compressed photo and commits it', async () => {
    const dir = await makeDataRepo();
    const store = await ShipStore.open(dir, { now: NOW });
    const png = await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const { ref } = await store.savePhoto(png, 'image/png', AUTHOR);
    expect(ref).toMatch(/^photos\/[0-9a-f]{12}\.jpg$/);
    expect((await simpleGit(dir).raw(['ls-files', ref])).trim()).toBe(ref);
  });

  it('persists WITHOUT committing when the data dir is not a git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-norepo-'));
    writeFileSync(join(dir, 'boat.yaml'), 'name: Scratch\n'); // minimal valid dataset
    const store = await ShipStore.open(dir, { now: NOW });
    const rec = await store.createRecord('vendor', { name: 'No Repo' }, '', AUTHOR);
    expect(rec.id).toBe('v-no-repo');
    expect(store.current().vendors.some((v) => v.id === 'v-no-repo')).toBe(true);
    const onDisk = await readFile(join(dir, 'vendors', 'v-no-repo.md'), 'utf8');
    expect(onDisk).toContain('id: v-no-repo'); // file written even with no commit
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- store`
Expected: FAIL — cannot resolve `src/server/store.js`.

- [ ] **Step 4: Write the implementation**

Create `src/server/store.ts`:
```ts
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import {
  loadDataset, type Dataset,
  collectionSchemas, createSchemas, maintenanceSchema, isoDate,
  deriveId, recordPath, toFileContents, COLLECTION_DIR, type CollectionName,
} from '../data/index.js';
import { GitRepo, type CommitAuthor } from './git.js';
import { compressPhoto, photoName } from './photos.js';

/** A stored record: validated frontmatter fields + its Markdown body. */
export type AnyRecord = Record<string, unknown> & { id: string; body: string };

/** A write failure the caller (a route) turns into an HTTP status. */
export class WriteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'WriteError';
  }
}

// Typed accessors that erase the schema union (and noUncheckedIndexedAccess
// friction) at one place, so call sites stay clean.
function createSchemaFor(c: CollectionName): z.ZodType<Record<string, unknown>> {
  return createSchemas[c] as unknown as z.ZodType<Record<string, unknown>>;
}
function recordSchemaFor(c: CollectionName): z.ZodType<Record<string, unknown>> {
  return collectionSchemas[c] as unknown as z.ZodType<Record<string, unknown>>;
}

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');
}

function isoToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The single server-side writer. Owns the in-memory dataset snapshot, a serial
 * write queue, and the local git client. Every mutation runs
 * validate → write file → commit → reload → atomic snapshot swap, so reads
 * (`current()`) always see a whole, consistent, freshly-validated dataset.
 */
export class ShipStore {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly dir: string,
    private snapshot: Dataset,
    private readonly git: GitRepo,
    private readonly now: () => Date,
  ) {}

  static async open(dir: string, opts: { now?: () => Date } = {}): Promise<ShipStore> {
    const snapshot = await loadDataset(dir);
    const git = await GitRepo.open(dir);
    return new ShipStore(dir, snapshot, git, opts.now ?? (() => new Date()));
  }

  /** The current role-agnostic dataset snapshot. Routes redact it per role. */
  current(): Dataset {
    return this.snapshot;
  }

  // ---- internals -----------------------------------------------------------

  /** Run `op` after all previously-queued ops; one failure never poisons the chain. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async reload(): Promise<void> {
    this.snapshot = await loadDataset(this.dir);
  }

  private records(collection: CollectionName): AnyRecord[] {
    return this.snapshot[COLLECTION_DIR[collection]] as unknown as AnyRecord[];
  }

  private find(collection: CollectionName, id: string): AnyRecord | undefined {
    return this.records(collection).find((r) => r.id === id);
  }

  private idsOf(collection: CollectionName): Set<string> {
    return new Set(this.records(collection).map((r) => r.id));
  }

  private async writeFileFor(collection: CollectionName, record: AnyRecord): Promise<void> {
    const abs = join(this.dir, recordPath(collection, record.id));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, toFileContents(record), 'utf8');
  }

  // ---- mutations -----------------------------------------------------------

  async createRecord(
    collection: CollectionName,
    input: unknown,
    body: string,
    author: CommitAuthor,
  ): Promise<AnyRecord> {
    const parsed = createSchemaFor(collection).safeParse(input);
    if (!parsed.success) throw new WriteError(formatZodError(parsed.error), 400);
    const fields = parsed.data;
    return this.enqueue(async () => {
      let id: string;
      try {
        id = deriveId(collection, fields, this.idsOf(collection));
      } catch (e) {
        throw new WriteError((e as Error).message, 400);
      }
      const record: AnyRecord = { id, ...fields, body };
      await this.writeFileFor(collection, record);
      await this.git.commitAll(`add ${collection} ${id}`, author);
      await this.reload(); // re-validates from disk; would throw loudly on a bad serialization
      return this.find(collection, id)!;
    });
  }

  async updateRecord(
    collection: CollectionName,
    id: string,
    patch: Record<string, unknown>,
    author: CommitAuthor,
  ): Promise<AnyRecord> {
    return this.enqueue(async () => {
      const existing = this.find(collection, id);
      if (!existing) throw new WriteError('not found', 404);
      const { body: patchBody, ...patchFields } = patch;
      const { body: _existingBody, ...frontmatter } = { ...existing, ...patchFields, id }; // id is immutable
      const parsed = recordSchemaFor(collection).safeParse(frontmatter);
      if (!parsed.success) throw new WriteError(formatZodError(parsed.error), 400);
      const body = typeof patchBody === 'string' ? patchBody : existing.body;
      const record: AnyRecord = { ...parsed.data, body } as AnyRecord;
      await this.writeFileFor(collection, record);
      await this.git.commitAll(`update ${collection} ${id}`, author);
      await this.reload();
      return this.find(collection, id)!;
    });
  }

  async deleteRecord(collection: CollectionName, id: string, author: CommitAuthor): Promise<void> {
    return this.enqueue(async () => {
      if (!this.find(collection, id)) throw new WriteError('not found', 404);
      await rm(join(this.dir, recordPath(collection, id)));
      await this.git.commitAll(`remove ${collection} ${id}`, author);
      await this.reload();
    });
  }

  async completeMaintenance(
    id: string,
    opts: { completed?: unknown; note?: unknown },
    author: CommitAuthor,
  ): Promise<AnyRecord> {
    return this.enqueue(async () => {
      const existing = this.find('maintenance', id);
      if (!existing) throw new WriteError('not found', 404);
      const completed = opts.completed === undefined ? isoToday(this.now()) : opts.completed;
      if (!isoDate.safeParse(completed).success) {
        throw new WriteError('completed must be an ISO date (YYYY-MM-DD)', 400);
      }
      let body = existing.body;
      if (opts.note !== undefined) {
        if (typeof opts.note !== 'string') throw new WriteError('note must be a string', 400);
        body = `${existing.body}\n\n## Completed ${completed}\n\n${opts.note}`.trim();
      }
      const { body: _b, ...frontmatter } = { ...existing, status: 'done', completed };
      const parsed = maintenanceSchema.safeParse(frontmatter);
      if (!parsed.success) throw new WriteError(formatZodError(parsed.error), 400);
      const record: AnyRecord = { ...parsed.data, body } as AnyRecord;
      await this.writeFileFor('maintenance', record);
      await this.git.commitAll(`complete maintenance ${id}`, author);
      await this.reload();
      return this.find('maintenance', id)!;
    });
  }

  async savePhoto(buf: Buffer, mime: string, author: CommitAuthor): Promise<{ ref: string }> {
    const compressed = await compressPhoto(buf, mime); // PhotoError(415|413) BEFORE the queue
    const ref = `photos/${photoName(compressed.bytes)}`;
    await this.enqueue(async () => {
      const abs = join(this.dir, ref);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, compressed.bytes);
      await this.git.commitAll(`add photo ${ref}`, author);
      // photos aren't part of the parsed dataset → no reload needed
    });
    return { ref };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- store && npm run typecheck`
Expected: PASS (9 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/store.ts test/server/helpers.ts test/server/store.test.ts
git commit -m "feat(server): ShipStore — single serialized writer (queue + local commit + reload)"
```

---

### Task 6: Thread `ShipStore` through the app (refactor; keep everything green)

Replace the injected raw `dataset` with `store`. Reads now call `store.current()`. **No new endpoints** — this is a pure refactor that must leave the entire existing suite green.

**Files:**
- Modify: `src/server/app.ts`, `src/server/routes/data.ts`, `src/server/routes/auth.ts`, `src/server/index.ts`, `test/server/helpers.ts`

- [ ] **Step 1: Update the app factory (replace `src/server/app.ts`)**

Replace the whole file with:
```ts
import express, {
  type Express,
  type ErrorRequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cookieParser from 'cookie-parser';
import type { Config } from './config.js';
import type { UsersStore } from './users.js';
import type { ShipStore } from './store.js';
import { attachRole } from './middleware.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDataRoutes } from './routes/data.js';
import { registerAdminRoutes } from './routes/admin.js';

export interface AppContext {
  config: Config;
  store: ShipStore;
  users: UsersStore;
  now: () => Date;
}

/** Basic hardening header on every response. */
function noSniff(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

/** Build the Express app from injected deps. `now` defaults to the real clock;
 *  tests inject a fixed clock so derived views stay deterministic. */
export function createApp(deps: Omit<AppContext, 'now'> & { now?: () => Date }): Express {
  const ctx: AppContext = { ...deps, now: deps.now ?? (() => new Date()) };
  const app = express();
  app.disable('x-powered-by');
  app.use(noSniff);
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachRole(ctx.config, ctx.now));
  registerAuthRoutes(app, ctx);
  registerDataRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  // Unmatched route -> JSON 404 (keeps the API JSON-only).
  app.use((_req, res) => { res.status(404).json({ error: 'not found' }); });

  // Global JSON error handler (must be registered last).
  const jsonErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : 500;
    res.status(status).json({ error: status >= 400 && status < 500 ? 'invalid request' : 'internal error' });
  };
  app.use(jsonErrorHandler);
  return app;
}
```
(The only change vs. P1b is `dataset: Dataset` → `store: ShipStore` and dropping the now-unused `Dataset` import. `registerWriteRoutes` is wired in Task 7.)

- [ ] **Step 2: Read via the store (modify `src/server/routes/data.ts`)**

Change the destructure line:
```ts
  const { dataset, now } = ctx;
  const view = (req: Request) => redactDataset(dataset, req.viewer.role);
```
to:
```ts
  const { store, now } = ctx;
  const view = (req: Request) => redactDataset(store.current(), req.viewer.role);
```
And change the two owner-only costs handlers from `dataset.costs` to `store.current().costs`:
```ts
  app.get('/api/costs', requireOwner, (_req, res) => res.json(store.current().costs));
  app.get('/api/costs/:id', requireOwner, (req, res) => {
    const c = store.current().costs.find((x) => x.id === req.params.id);
    if (c) res.json(c); else res.status(404).json({ error: 'not found' });
  });
```

- [ ] **Step 3: Read via the store in the welcome route (modify `src/server/routes/auth.ts`)**

Change the destructure:
```ts
  const { config, dataset, users, now } = ctx;
```
to:
```ts
  const { config, store, users, now } = ctx;
```
And in the `/api/welcome` handler change `dataset.boat` to `store.current().boat`:
```ts
  app.get('/api/welcome', (_req, res) => {
    const { name, make, model, year, hailingPort, welcome } = store.current().boat;
    res.json({ name, make, model, year, hailingPort, welcome: welcome ?? {} });
  });
```

- [ ] **Step 4: Build the store at boot (modify `src/server/index.ts`)**

Replace the data-loading import + line. Change:
```ts
import { loadDataset } from '../data/index.js';
```
to:
```ts
import { ShipStore } from './store.js';
```
Change:
```ts
  const dataset = await loadDataset(config.dataDir);
```
to:
```ts
  const store = await ShipStore.open(config.dataDir);
```
And change the `createApp` call from `{ config, dataset, users }` to `{ config, store, users }`:
```ts
  const server = createApp({ config, store, users }).listen(config.port, () => {
    console.log(`Ship's Log server listening on :${config.port}${config.demo ? ' (DEMO MODE)' : ''}`);
  });
```

- [ ] **Step 5: Build the store in the test helper (modify `test/server/helpers.ts`)**

Add the store import beside the others:
```ts
import { ShipStore } from '../../src/server/store.js';
```
Replace the `buildTestApp` function body and the `TestApp` interface with:
```ts
export interface TestApp {
  app: Express;
  users: UsersStore;
  config: Config;
  store: ShipStore;
  dataDir: string;
}

/**
 * Build an app over the demo dataset. Default = authenticated (non-demo) mode
 * with a seeded owner1/crew1 over a throwaway git data repo; pass { demo: true }
 * for the no-auth demo path.
 */
export async function buildTestApp(opts: { demo?: boolean } = {}): Promise<TestApp> {
  const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
  const dataDir = opts.demo ? DEMO : await makeDataRepo();
  const env = opts.demo
    ? { USERS_PATH: usersPath }
    : { DATA_DIR: dataDir, SESSION_SECRET: 'test-secret', COOKIE_SECURE: 'false', USERS_PATH: usersPath };
  const config = loadConfig(env, DEMO);
  const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW });
  const users = await UsersStore.load(usersPath);
  if (!opts.demo) {
    await users.add('owner1', 'ownerpass123', 'owner');
    await users.add('crew1', 'crewpass123', 'crew');
  }
  const app = createApp({ config, store, users, now: FIXED_NOW });
  return { app, users, config, store, dataDir };
}
```
(`makeDataRepo` was added in Task 5. The old helper's `loadDataset` import may now be unused — remove it if your typecheck/linter flags it.)

- [ ] **Step 6: Run the FULL suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: ALL existing suites PASS (data layer, write, git, photos, store, config, session, users, redact, auth, data, redaction-golden, admin, demo) and typecheck is clean. This refactor changes how the dataset is threaded, not any behavior, so nothing should regress.

- [ ] **Step 7: Commit**

```bash
git add src/server/app.ts src/server/routes/data.ts src/server/routes/auth.ts src/server/index.ts test/server/helpers.ts
git commit -m "refactor(server): thread ShipStore through createApp; reads use store.current()"
```

---

### Task 7: Write routes + per-record redaction

The HTTP surface. Crew can create/edit trips, mark maintenance complete, and upload photos; everything else (other collections, all deletes, full maintenance edit) is owner-only. `denyInDemo` on every route. Responses pass through `redactRecord`.

**Files:**
- Modify: `src/server/redact.ts` (add `redactRecord`)
- Create: `src/server/routes/writes.ts`
- Modify: `src/server/app.ts` (wire the write routes)
- (Tested in Task 8.)

- [ ] **Step 1: Add per-record redaction (modify `src/server/redact.ts`)**

Append to `src/server/redact.ts` (it already imports `MONETARY_FIELDS` and `OWNER_ONLY_COLLECTIONS`):
```ts
/**
 * Redact a SINGLE record for a write response. Owners get it unchanged. For
 * crew/guest: owner-only collections return null (must never be echoed back) and
 * monetary fields are stripped. Mirrors redactDataset, per record. `collection`
 * is the singular name (e.g. 'maintenance', 'cost').
 */
export function redactRecord<T extends Record<string, unknown>>(
  collection: string,
  record: T,
  role: Role,
): T | null {
  if (role === 'owner') return record;
  if ((OWNER_ONLY_COLLECTIONS as readonly string[]).includes(collection)) return null;
  const fields = MONETARY_FIELDS[collection] ?? [];
  if (fields.length === 0) return record;
  const copy = structuredClone(record);
  for (const f of fields) delete (copy as Record<string, unknown>)[f];
  return copy;
}
```

- [ ] **Step 2: Write the write routes**

Create `src/server/routes/writes.ts`:
```ts
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import type { AppContext } from '../app.js';
import { requireAuth, requireOwner, denyInDemo } from '../middleware.js';
import { redactRecord } from '../redact.js';
import { WriteError } from '../store.js';
import { PhotoError } from '../photos.js';
import { COLLECTION_DIR, type CollectionName } from '../../data/index.js';

// memoryStorage → req.file.buffer; the hard cap is defense-in-depth (the app-level
// 25 MB / type checks live in photos.ts and yield 413/415).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

/** Commit author from the logged-in user (fallback to a generic app identity). */
function authorFor(req: Request): { name: string; email: string } {
  const name = req.viewer.username ?? "Ship's Log";
  return { name, email: `${name.replace(/\s+/g, '-').toLowerCase()}@shiplog.local` };
}

function fail(res: Response, err: unknown): void {
  if (err instanceof WriteError || err instanceof PhotoError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: 'internal error' });
}

export function registerWriteRoutes(app: Express, ctx: AppContext): void {
  const { store, config } = ctx;
  const noDemo = denyInDemo(config);

  // ---- Trips: crew + owner ----
  app.post('/api/trips', requireAuth, noDemo, async (req, res) => {
    const { body: narrative, ...fields } = req.body ?? {};
    try {
      const rec = await store.createRecord('trip', fields, typeof narrative === 'string' ? narrative : '', authorFor(req));
      res.status(201).json(redactRecord('trip', rec, req.viewer.role));
    } catch (err) { fail(res, err); }
  });

  app.put('/api/trips/:id', requireAuth, noDemo, async (req, res) => {
    try {
      const rec = await store.updateRecord('trip', req.params.id, req.body ?? {}, authorFor(req));
      res.json(redactRecord('trip', rec, req.viewer.role));
    } catch (err) { fail(res, err); }
  });

  // ---- Maintenance complete: crew + owner (narrow op — never touches costEst) ----
  app.post('/api/maintenance/:id/complete', requireAuth, noDemo, async (req, res) => {
    const { completed, note } = req.body ?? {};
    try {
      const rec = await store.completeMaintenance(req.params.id, { completed, note }, authorFor(req));
      res.json(redactRecord('maintenance', rec, req.viewer.role));
    } catch (err) { fail(res, err); }
  });

  // ---- Owner-only create/edit for the remaining collections ----
  const OWNER_WRITABLE: CollectionName[] = ['maintenance', 'inventory', 'vendor', 'cost', 'manual'];
  for (const collection of OWNER_WRITABLE) {
    const base = `/api/${COLLECTION_DIR[collection]}`;
    app.post(base, requireOwner, noDemo, async (req, res) => {
      const { body: narrative, ...fields } = req.body ?? {};
      try {
        const rec = await store.createRecord(collection, fields, typeof narrative === 'string' ? narrative : '', authorFor(req));
        res.status(201).json(redactRecord(collection, rec, req.viewer.role));
      } catch (err) { fail(res, err); }
    });
    app.put(`${base}/:id`, requireOwner, noDemo, async (req, res) => {
      try {
        const rec = await store.updateRecord(collection, req.params.id, req.body ?? {}, authorFor(req));
        res.json(redactRecord(collection, rec, req.viewer.role));
      } catch (err) { fail(res, err); }
    });
  }

  // ---- Deletes: owner-only, every collection (including trips) ----
  const ALL: CollectionName[] = ['trip', 'maintenance', 'inventory', 'vendor', 'cost', 'manual'];
  for (const collection of ALL) {
    app.delete(`/api/${COLLECTION_DIR[collection]}/:id`, requireOwner, noDemo, async (req, res) => {
      try {
        await store.deleteRecord(collection, req.params.id, authorFor(req));
        res.status(204).end();
      } catch (err) { fail(res, err); }
    });
  }

  // ---- Photos: crew + owner (multipart field "photo") ----
  app.post('/api/photos', requireAuth, noDemo, upload.single('photo'), async (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'multipart file field "photo" required' }); return; }
    try {
      const out = await store.savePhoto(req.file.buffer, req.file.mimetype, authorFor(req));
      res.status(201).json(out);
    } catch (err) { fail(res, err); }
  });
}
```

- [ ] **Step 3: Wire the write routes into the app (modify `src/server/app.ts`)**

Add the import beside the other route-group imports:
```ts
import { registerWriteRoutes } from './routes/writes.js';
```
And call it right after `registerAdminRoutes(app, ctx);` (before the 404 handler):
```ts
  registerAdminRoutes(app, ctx);
  registerWriteRoutes(app, ctx);
```

- [ ] **Step 4: Typecheck (tests land in Task 8)**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; the existing suite still green (the new routes are registered but not yet exercised — nothing regresses).

- [ ] **Step 5: Commit**

```bash
git add src/server/redact.ts src/server/routes/writes.ts src/server/app.ts
git commit -m "feat(server): write routes (record CRUD + maintenance-complete + photos) with per-record redaction"
```

---

### Task 8: Write-route tests (scope, validation, demo, photos)

End-to-end HTTP tests over supertest: the crew write scope, owner full CRUD, validation/404, demo lockout, and photo upload.

**Files:**
- Test: `test/server/writes.test.ts`

- [ ] **Step 1: Write the test**

Create `test/server/writes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { buildTestApp } from './helpers.js';

async function loginAs(role: 'owner' | 'crew') {
  const { app } = await buildTestApp();
  const agent = request.agent(app);
  await agent.post('/api/login').send({
    username: role === 'owner' ? 'owner1' : 'crew1',
    password: role === 'owner' ? 'ownerpass123' : 'crewpass123',
  });
  return agent;
}

describe('write routes — crew scope', () => {
  it('lets crew create a trip (server derives the id) and reads it back', async () => {
    const agent = await loginAs('crew');
    const res = await agent.post('/api/trips').send({ date: '2024-08-10', title: 'Bay sail', body: 'Sunny.' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('t-2024-08-10');
    const got = await agent.get('/api/trips/t-2024-08-10');
    expect(got.status).toBe(200);
    expect(got.body.title).toBe('Bay sail');
    expect(got.body.body).toBe('Sunny.');
  });

  it('accepts a partial trip (date + body only)', async () => {
    const agent = await loginAs('crew');
    await agent.post('/api/trips').send({ date: '2024-08-11', body: 'Just a note.' }).expect(201);
  });

  it('lets crew edit a trip', async () => {
    const agent = await loginAs('crew');
    const res = await agent.put('/api/trips/t-2024-06-22').send({ title: 'Shakedown II' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Shakedown II');
  });

  it('lets crew mark maintenance complete but strips costEst from the response', async () => {
    const agent = await loginAs('crew');
    const res = await agent.post('/api/maintenance/m-jib-halyard/complete').send({ completed: '2024-07-05', note: 'Done.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completed).toBe('2024-07-05');
    expect('costEst' in res.body).toBe(false); // redaction-on-write
  });

  it('forbids crew from every owner-only write (403)', async () => {
    const agent = await loginAs('crew');
    await agent.post('/api/costs').send({ date: '2024-08-01', item: 'x', amount: 5 }).expect(403);
    await agent.post('/api/vendors').send({ name: 'x' }).expect(403);
    await agent.post('/api/inventory').send({ name: 'x' }).expect(403);
    await agent.post('/api/manuals').send({ title: 'x' }).expect(403);
    await agent.put('/api/maintenance/m-jib-halyard').send({ costEst: 1 }).expect(403); // full edit
    await agent.delete('/api/trips/t-2024-06-22').expect(403);
    await agent.delete('/api/maintenance/m-jib-halyard').expect(403);
  });
});

describe('write routes — owner CRUD', () => {
  it('lets owner create/update/delete across collections, keeping monetary fields', async () => {
    const agent = await loginAs('owner');

    const vendor = await agent.post('/api/vendors').send({ name: 'Rigging Pros', phone: '555-0100' });
    expect(vendor.status).toBe(201);
    expect(vendor.body.id).toBe('v-rigging-pros');

    const cost = await agent.post('/api/costs').send({ date: '2024-08-01', item: 'New shackle', amount: 42.5 });
    expect(cost.status).toBe(201);
    expect(cost.body.amount).toBe(42.5); // owner sees monetary

    const maint = await agent.post('/api/maintenance').send({ title: 'Bottom paint', status: 'scheduled', costEst: 300 });
    expect(maint.status).toBe(201);
    expect(maint.body.id).toBe('m-bottom-paint');
    expect(maint.body.costEst).toBe(300);

    const upd = await agent.put(`/api/maintenance/${maint.body.id}`).send({ priority: 2 });
    expect(upd.status).toBe(200);
    expect(upd.body.priority).toBe(2);

    await agent.delete(`/api/maintenance/${maint.body.id}`).expect(204);
    await agent.get(`/api/maintenance/${maint.body.id}`).expect(404);
  });

  it('404s update/delete/complete on an unknown id', async () => {
    const agent = await loginAs('owner');
    await agent.put('/api/trips/t-nope').send({ title: 'x' }).expect(404);
    await agent.delete('/api/vendors/v-nope').expect(404);
    await agent.post('/api/maintenance/m-nope/complete').send({}).expect(404);
  });

  it('rejects an invalid create with 400', async () => {
    const agent = await loginAs('owner');
    await agent.post('/api/trips').send({ date: 'someday' }).expect(400);
    await agent.post('/api/vendors').send({}).expect(400); // name required
  });

  it('suffixes a colliding id', async () => {
    const agent = await loginAs('owner');
    const a = await agent.post('/api/vendors').send({ name: 'Dock Shop' });
    const b = await agent.post('/api/vendors').send({ name: 'Dock Shop' });
    expect(a.body.id).toBe('v-dock-shop');
    expect(b.body.id).toBe('v-dock-shop-2');
  });
});

describe('write routes — guards', () => {
  it('requires auth (guest = 401)', async () => {
    const { app } = await buildTestApp();
    await request(app).post('/api/trips').send({ date: '2024-08-01' }).expect(401);
    await request(app).post('/api/photos').expect(401);
  });

  it('disables every write in demo mode (403)', async () => {
    const { app } = await buildTestApp({ demo: true });
    await request(app).post('/api/trips').send({ date: '2024-08-01' }).expect(403);
    await request(app).post('/api/maintenance/m-jib-halyard/complete').send({}).expect(403);
    await request(app).post('/api/vendors').send({ name: 'x' }).expect(403);
    await request(app).delete('/api/trips/t-2024-06-22').expect(403);
    await request(app).post('/api/photos').expect(403);
  });
});

describe('photo upload', () => {
  it('accepts an image, compresses it, and returns a repo-relative ref', async () => {
    const agent = await loginAs('crew');
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 5, g: 90, b: 150 } } }).png().toBuffer();
    const res = await agent.post('/api/photos').attach('photo', png, { filename: 'sail.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.ref).toMatch(/^photos\/[0-9a-f]{12}\.jpg$/);
  });

  it('rejects an unsupported image type (415)', async () => {
    const agent = await loginAs('crew');
    const res = await agent.post('/api/photos').attach('photo', Buffer.from('GIF89a'), { filename: 'x.gif', contentType: 'image/gif' });
    expect(res.status).toBe(415);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- writes`
Expected: PASS (all `it`s). If a `403` case instead returns `201`/`200`, a route is missing its `requireOwner` guard; if demo writes don't `403`, a route is missing `noDemo`.

- [ ] **Step 3: Commit**

```bash
git add test/server/writes.test.ts
git commit -m "test(server): write-route scope, validation, demo lockout, photo upload"
```

---

### Task 9: Extend the redaction-golden test to write responses

The redaction invariant must hold for write responses too — the golden net should deep-walk what crew gets back from a write, not just reads.

**Files:**
- Modify: `test/server/redaction-golden.test.ts`

- [ ] **Step 1: Add the write-response case**

Append this `it` inside the existing `describe('cost-redaction golden test', …)` block in `test/server/redaction-golden.test.ts` (it reuses the file's existing `assertNoMonetaryKey` helper and `buildTestApp` import):
```ts
  it('no monetary key appears in any crew WRITE response', async () => {
    const { app } = await buildTestApp();
    const agent = request.agent(app);
    await agent.post('/api/login').send({ username: 'crew1', password: 'crewpass123' });

    const trip = await agent.post('/api/trips').send({ date: '2024-08-20', title: 'Eve sail', body: 'Calm.' });
    expect(trip.status).toBe(201);
    assertNoMonetaryKey(trip.body, 'POST /api/trips');

    // Completing a maintenance item that carries a costEst must not echo it back.
    const done = await agent.post('/api/maintenance/m-jib-halyard/complete').send({ completed: '2024-07-09' });
    expect(done.status).toBe(200);
    assertNoMonetaryKey(done.body, 'POST /api/maintenance/:id/complete');
    expect('costEst' in done.body).toBe(false);
  });
```

- [ ] **Step 2: Run the golden test**

Run: `npm test -- redaction-golden`
Expected: PASS. If `costEst` shows up in the complete response, `redactRecord` isn't being applied at that route — fix the route, do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add test/server/redaction-golden.test.ts
git commit -m "test(server): extend redaction-golden to crew write responses"
```

---

### Task 10: Docs refresh + final green run

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Update `README.md` — Status paragraph**

Replace the `## Status` body (lines under the heading) with:
```markdown
In development. The data core (P1a), the read server (P1b), and the write layer
(P1c) are built: a headless data layer (`src/data/`) plus an Express REST API
(`src/server/`) with app-level auth (signed-cookie sessions, three roles),
server-side cost redaction, record writes committed to the local data repo, and
photo upload. Two-way git sync (P2) and the SPA (P1d) follow in later plans.
```

- [ ] **Step 2: Update `README.md` — add a Write API section**

Insert a new section after the `## Run the server` section's environment list (before `## Layout`):
```markdown
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
```

- [ ] **Step 3: Update `README.md` — Layout bullets**

In the `src/data/` bullet, change the end of the list `…  \`search\`. Public API is \`src/data/index.ts\`.` to:
```markdown
  `search`, `write` (record↔file + server-side id derivation). Public API is
  `src/data/index.ts`.
```
Replace the `src/server/` bullet with:
```markdown
- `src/server/` — the server: `config`, `session`, `users` (argon2id store),
  `redact` (role-scoped dataset view + per-record redaction), `middleware`,
  `store` (`ShipStore`: in-memory snapshot + serial write queue + reload), `git`
  (local commit), `photos` (`sharp` compression), `routes/` (auth, data, admin,
  writes), `app` (`createApp` factory), `index` (boot). Imports the data layer
  only from `src/data/index.ts`.
```
Also add a line to the test-dirs/`demo` list noting test coverage of writes (optional, under the existing `test/data/` bullet):
```markdown
- `test/server/` — Vitest + supertest tests for the server (auth, reads, redaction,
  admin, demo, writes, store, git, photos).
```

- [ ] **Step 4: Update `CLAUDE.md` — add the write-layer section**

Append a new section after the existing `## Server layer (P1b)` section:
```markdown
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
```

- [ ] **Step 5: Final full green run + typecheck**

Run: `npm test && npm run typecheck`
Expected: ALL suites PASS; typecheck clean.

- [ ] **Step 6: Smoke-test writes against a running scratch repo (manual, optional but recommended)**

```bash
# Create a throwaway data repo from the demo dataset.
rm -rf /tmp/slog-scratch && cp -r demo /tmp/slog-scratch && git -C /tmp/slog-scratch init -q && \
  git -C /tmp/slog-scratch add -A && git -C /tmp/slog-scratch -c user.email=a@b -c user.name=a commit -qm seed

DATA_DIR=/tmp/slog-scratch SESSION_SECRET=dev COOKIE_SECURE=false OWNER_USERNAME=cap OWNER_PASSWORD=ownerpass123 npm start &
sleep 1
# Log in, capture the cookie, create a trip, see the commit.
curl -s -c /tmp/slog.cookie -X POST localhost:8080/api/login -H 'content-type: application/json' -d '{"username":"cap","password":"ownerpass123"}'
curl -s -b /tmp/slog.cookie -X POST localhost:8080/api/trips -H 'content-type: application/json' -d '{"date":"2024-08-15","title":"Smoke test","body":"It works."}'
git -C /tmp/slog-scratch log --oneline -1   # => "add trip t-2024-08-15"
kill %1
```
Expected: the POST returns `201` with `"id":"t-2024-08-15"`; the data repo has a new commit authored `cap`.

- [ ] **Step 7: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs(p1c): document the write API, ShipStore, git/photo layers in README + CLAUDE"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-16-ship-log-p1c-writes-design.md`):
- Record writes `POST`/`PUT`/`DELETE` for the six collections, validated before disk/git → Tasks 5 (store), 7 (routes), 8 (tests) ✓
- Single serialized writer / write queue → Task 5 (`enqueue`), tested by the concurrency case ✓
- Local git commit per write, authored as the logged-in user; non-repo persist-without-commit → Tasks 3, 5 ✓
- Photo upload: validate → compress (`sharp`) → store → return ref → Tasks 4, 5 (`savePhoto`), 7 (`POST /api/photos`) ✓
- Crew write scope (trips + maintenance-complete + photos; everything else owner-only) → Task 7, tested in Task 8 ✓
- Dedicated `/complete` narrow op (no `costEst` reachable by crew) → Tasks 5, 7 ✓
- Redaction-on-write (`redactRecord`), golden extended → Tasks 7, 9 ✓
- Server-side id derivation with collision suffixing → Task 2, tested in Tasks 2/5/8 ✓
- Stateful `ShipStore` (snapshot + reload-and-swap), `createApp` threaded with `store` → Tasks 5, 6 ✓
- `denyInDemo` on every write route → Task 7, tested in Task 8 ✓
- Error handling: 400 before disk/git, 404 unknown id, 413/415 photos, 403 scope/demo → Tasks 4, 5, 7, 8 ✓
- Out of scope (correctly absent): pull/push/sync/conflicts/credentials (P2), `boat.yaml`/`quickref.yaml` editing, the SPA (P1d) ✓
- Doc-upkeep: README + CLAUDE updated → Task 10 ✓

**Placeholder scan:** No TBD/TODO. Every code step shows complete code; every test step shows assertions + the run command + expected result.

**Type consistency:** `CollectionName`, `COLLECTION_DIR`, `createSchemas`, `recordPath`, `slugify`, `deriveId`, `toFileContents` (data layer) are defined in Task 2 and used unchanged in Tasks 5/7. `ShipStore` with `open`/`current`/`createRecord`/`updateRecord`/`deleteRecord`/`completeMaintenance`/`savePhoto` and `WriteError`/`AnyRecord` (Task 5) are consumed verbatim by `routes/writes.ts` (Task 7). `GitRepo.open`/`commitAll`/`CommitAuthor`/`enabled` (Task 3) and `compressPhoto`/`photoName`/`PhotoError`/`CompressedPhoto` (Task 4) are used by `store.ts`. `redactRecord(collection, record, role)` (Task 7) takes the singular collection name, matching `MONETARY_FIELDS`/`OWNER_ONLY_COLLECTIONS` keys. `AppContext.store` replaces `AppContext.dataset` consistently across `app.ts`/`data.ts`/`auth.ts`/`index.ts`/`helpers.ts` (Task 6). `makeDataRepo` (Task 5) is reused by `buildTestApp` (Task 6). `now` is injected identically into both `ShipStore.open` and `createApp` in the helper and entry point.

**One deliberate small duplication:** `redact.ts` keeps its own `DATASET_KEY` (typed `keyof Dataset`) while `write.ts` introduces `COLLECTION_DIR` (the same singular→plural mapping). They are kept separate so this plan never edits the security-critical `redactDataset`; both are tiny and independently tested.
