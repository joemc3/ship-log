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
