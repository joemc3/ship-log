import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import {
  loadDataset, type Dataset,
  collectionSchemas, createSchemas, maintenanceSchema, isoDate,
  deriveId, recordPath, toFileContents, COLLECTION_DIR, type CollectionName,
} from '../data/index.js';
import { GitRepo, type CommitAuthor, type GitCredentials, type PullResult } from './git.js';
import { compressPhoto, photoName } from './photos.js';

/** A stored record: validated frontmatter fields + its Markdown body. */
export type AnyRecord = Record<string, unknown> & { id: string; body: string };

/**
 * Observable two-way-sync state. Mutated ONLY from inside the serial write queue
 * (post-write sync) or the scheduler's queued pull, so it never disagrees with the
 * in-memory snapshot.
 *
 *  - `ok`       — last sync attempt succeeded (or sync is disabled / nothing to do).
 *  - `conflict` — a `pull --rebase` hit a conflict; the write was persisted+committed
 *                 locally but NOT pushed, and auto-push is PAUSED until a clean pull
 *                 clears it (resolved out-of-band via Cowork/CLI). Never force-pushed.
 *  - `offline`  — a transport/credential failure; retry later. The local write still
 *                 committed; the commit will push on a later successful sync.
 *
 * `lastError` is a GENERIC, sanitized reason (never a remote URL or filesystem path)
 * safe to surface to an authenticated client; full detail stays in the server log.
 */
export type SyncStatus = 'ok' | 'conflict' | 'offline';

export interface SyncState {
  status: SyncStatus;
  lastPullAt?: Date;
  lastPushAt?: Date;
  lastError?: string;
}

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

/** Generic, client-safe sync reasons. We deliberately never surface git's raw
 *  error text (it can carry the remote URL / a filesystem path); the full detail
 *  is logged server-side by the git layer. */
const SYNC_CONFLICT_MSG = 'sync conflict: remote and local diverged; resolve via Cowork/CLI';
const SYNC_OFFLINE_MSG = 'sync unavailable: could not reach the data remote';

/**
 * The single server-side writer. Owns the in-memory dataset snapshot, a serial
 * write queue, and the local git client. Every mutation runs
 * validate → write file → commit → reload → atomic snapshot swap, so reads
 * (`current()`) always see a whole, consistent, freshly-validated dataset.
 */
export class ShipStore {
  private queue: Promise<unknown> = Promise.resolve();

  /** Observable sync state; only ever mutated inside the serial queue. */
  private sync: SyncState = { status: 'ok' };

  private constructor(
    private readonly dir: string,
    private snapshot: Dataset,
    private readonly git: GitRepo,
    private readonly now: () => Date,
    /** Whether the clone has a remote to sync against (cached at open). A git repo
     *  with no `origin` (local scratch clone) commits but never pulls/pushes. */
    private readonly syncable: boolean,
  ) {}

  /**
   * Open the store over a working-clone `dir`. Pass a pre-opened `git` (e.g. the
   * result of `GitRepo.clone` on boot) to reuse the clone + its credentials;
   * otherwise the store opens `dir` in place (with optional `creds` for later
   * remote ops).
   */
  static async open(
    dir: string,
    opts: { now?: () => Date; git?: GitRepo; creds?: GitCredentials } = {},
  ): Promise<ShipStore> {
    const snapshot = await loadDataset(dir);
    const git = opts.git ?? (await GitRepo.open(dir, opts.creds));
    const syncable = await git.hasRemote();
    return new ShipStore(dir, snapshot, git, opts.now ?? (() => new Date()), syncable);
  }

  /** The current role-agnostic dataset snapshot. Routes redact it per role. */
  current(): Dataset {
    return this.snapshot;
  }

  /** A copy of the current sync state (status + last pull/push times + reason). */
  syncState(): SyncState {
    return { ...this.sync };
  }

  /** True when the working clone is a git repo with a remote to sync against (not
   *  a scratch dir, a no-remote local repo, or demo). The scheduler only starts
   *  when this is true. */
  syncEnabled(): boolean {
    return this.syncable;
  }

  // ---- sync -----------------------------------------------------------------

  /**
   * Pull the remote (via the serial queue, so it never interleaves with a write),
   * reload the in-memory dataset if HEAD advanced, and fold the result into the
   * observable sync state. A clean pull CLEARS a prior `conflict`/`offline` pause,
   * re-enabling auto-push on the next write. The scheduler calls this on a timer;
   * the post-write path also uses the same underlying logic.
   *
   * Resolves with the underlying {@link PullResult} (`disabled` when sync is off).
   */
  async pull(): Promise<PullResult> {
    return this.enqueue(() => this.pullInQueue());
  }

  /** The pull body, assumed to already be running inside the serial queue. */
  private async pullInQueue(): Promise<PullResult> {
    if (!this.syncable) return { status: 'disabled', ok: false, conflict: false };
    const before = await this.git.headSha();
    const res = await this.git.pullRebase();
    if (await this.headAdvanced(before)) await this.reload(); // refresh dataset if HEAD moved
    this.applyPull(res);
    return res;
  }

  /** True iff HEAD differs from `before` (a pull/rebase advanced it). A null/null
   *  pair means nothing changed. */
  private async headAdvanced(before: string | null): Promise<boolean> {
    return (await this.git.headSha()) !== before;
  }

  /**
   * Post-write sync: integrate the remote then push our just-committed change.
   * Assumed to run inside the serial queue, right after a write's local commit.
   * PAUSED while in `conflict` (commit-only until a clean pull clears it). A
   * transport failure flips to `offline`; the local commit stays and pushes later.
   */
  private async syncAfterWrite(): Promise<void> {
    if (!this.syncable) return;           // scratch dir / no-remote / demo: persist-without-sync
    if (this.sync.status === 'conflict') return; // auto-push paused until resolved

    const before = await this.git.headSha();
    const pull = await this.git.pullRebase();
    // A rebase that replays our just-committed write advances HEAD with a zero-file
    // merge summary, so key the reload off the actual HEAD move, not pull.status.
    if (await this.headAdvanced(before)) await this.reload();
    if (pull.conflict) { this.applyPull(pull); return; }            // → conflict, do not push
    if (pull.status === 'error') { this.applyPull(pull); return; }  // → offline, do not push
    // pull was clean (up-to-date / fast-forward / rebase-replayed): record it, then push.
    this.sync.lastPullAt = this.now();

    const push = await this.git.push();
    this.applyPush(push);
  }

  /** Fold a {@link PullResult} into sync-state. */
  private applyPull(res: PullResult): void {
    if (res.status === 'disabled') return;
    if (res.conflict) {
      this.sync = { ...this.sync, status: 'conflict', lastError: SYNC_CONFLICT_MSG };
      return;
    }
    if (res.status === 'error') {
      this.sync = { ...this.sync, status: 'offline', lastError: SYNC_OFFLINE_MSG };
      return;
    }
    // up-to-date or fast-forward → clean. Clears any prior pause.
    this.sync = { status: 'ok', lastPushAt: this.sync.lastPushAt, lastPullAt: this.now() };
  }

  /** Fold a {@link PushResult} into sync-state (called only after a clean pull). */
  private applyPush(res: { status: string; conflict: boolean; ok: boolean }): void {
    if (res.status === 'disabled') return;
    if (res.conflict) {
      this.sync = { ...this.sync, status: 'conflict', lastError: SYNC_CONFLICT_MSG };
      return;
    }
    if (res.status === 'error') {
      this.sync = { ...this.sync, status: 'offline', lastError: SYNC_OFFLINE_MSG };
      return;
    }
    // pushed or up-to-date → fully clean.
    this.sync = { status: 'ok', lastPullAt: this.sync.lastPullAt, lastPushAt: this.now() };
  }

  // ---- internals -----------------------------------------------------------

  /** Run `op` after all previously-queued ops; one failure never poisons the chain. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  // If loadDataset throws on a bad serialization, the snapshot stays at the last
  // good state while disk/git may be ahead — by design; self-heals on the next
  // successful reload.
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
      await this.git.commitPaths([recordPath(collection, id)], `add ${collection} ${id}`, author);
      await this.reload(); // re-validates from disk; would throw loudly on a bad serialization
      await this.syncAfterWrite();
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
      await this.git.commitPaths([recordPath(collection, id)], `update ${collection} ${id}`, author);
      await this.reload();
      await this.syncAfterWrite();
      return this.find(collection, id)!;
    });
  }

  async deleteRecord(collection: CollectionName, id: string, author: CommitAuthor): Promise<void> {
    return this.enqueue(async () => {
      if (!this.find(collection, id)) throw new WriteError('not found', 404);
      const path = recordPath(collection, id);
      await rm(join(this.dir, path));
      await this.git.commitPaths([path], `remove ${collection} ${id}`, author);
      await this.reload();
      await this.syncAfterWrite();
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
      await this.git.commitPaths([recordPath('maintenance', id)], `complete maintenance ${id}`, author);
      await this.reload();
      await this.syncAfterWrite();
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
      await this.git.commitPaths([ref], `add photo ${ref}`, author);
      // photos aren't part of the parsed dataset → no reload needed
      await this.syncAfterWrite();
    });
    return { ref };
  }
}
