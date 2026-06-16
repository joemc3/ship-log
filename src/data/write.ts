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
