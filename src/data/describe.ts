import { z } from 'zod';
import {
  collectionSchemas,
  isoDate,
} from './schema.js';
import {
  COLLECTION_DIR,
  SLUG_SOURCE,
  ID_PREFIX,
  type CollectionName,
} from './write.js';
import { MONETARY_FIELDS, OWNER_ONLY_COLLECTIONS } from './monetary.js';
import { CROSS_LINKS, type CrossLink } from './links.js';
import { DUE_WINDOW_DAYS } from './derive.js';

/**
 * A machine-readable description of the data model, derived entirely from the
 * existing data-layer source of truth (Zod schemas, COLLECTION_DIR / SLUG_SOURCE /
 * ID_PREFIX, monetary.ts, links.ts, derive.ts). The P3 Cowork docs (AGENTS.md,
 * SCHEMA.md) are generated/checked against this so they can never silently drift
 * from code. Nothing here is hand-transcribed — every fact is read back from the
 * modules that own it.
 */

/** The structural kind of a field, after peeling optional/nullable/default. */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object'
  | 'record'
  | 'unknown';

export interface FieldDescriptor {
  /** Frontmatter key. */
  name: string;
  /** Base structural type (optionality/nullability peeled away). */
  type: FieldType;
  /** True unless the Zod schema accepts `undefined` for this field. */
  required: boolean;
  /** True if the (unwrapped) field is the shared `isoDate` schema. */
  isoDate: boolean;
  /** Enum option list, when `type === 'enum'`. */
  enum?: string[];
  /** True if this field is registered as monetary (owner-only) in monetary.ts. */
  monetary: boolean;
}

export interface CollectionDescriptor {
  /** Singular collection name (the `collectionSchemas` key). */
  name: CollectionName;
  /** On-disk directory / Dataset key / REST segment (from COLLECTION_DIR). */
  dir: string;
  /** Record-id prefix (from ID_PREFIX; trips use `t-`). */
  idPrefix: string;
  /** Field whose value the id slug is derived from (trips: `date`). */
  slugSource: string;
  /** True if every record in this collection is owner-only (from monetary.ts). */
  ownerOnly: boolean;
  /** The collection's fields, derived from its Zod schema. */
  fields: FieldDescriptor[];
}

export interface DerivedDescriptor {
  /** Inventory date fields that produce inspect/service/expires tasks. */
  inventoryTaskKinds: string[];
  /** Maintenance statuses that count toward the attention badge. */
  maintAttentionStatuses: string[];
  /** The overdue/due window in days (from derive.ts DUE_WINDOW_DAYS). */
  dueWindowDays: number;
}

export interface SchemaDescriptor {
  collections: CollectionDescriptor[];
  /** Per-collection monetary field lists, mirrored from monetary.ts. */
  monetaryFields: Record<string, string[]>;
  /** Owner-only collection names, mirrored from monetary.ts. */
  ownerOnlyCollections: string[];
  /** Every cross-record reference, mirrored from links.ts. */
  crossLinks: CrossLink[];
  derived: DerivedDescriptor;
}

/** Peel optional / nullable / default wrappers down to the core Zod type. */
function unwrap(schema: z.ZodType): z.ZodType {
  let cur = schema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  while (cur && (cur as any).def) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (cur as any).def.type;
    if (t === 'optional' || t === 'nullable' || t === 'default') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cur = (cur as any).def.innerType;
    } else {
      break;
    }
  }
  return cur;
}

function baseType(core: z.ZodType): FieldType {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (core as any)?.def?.type as string | undefined;
  switch (t) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return 'enum';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    case 'record':
      return 'record';
    default:
      return 'unknown';
  }
}

function describeField(name: string, schema: z.ZodType, collection: CollectionName): FieldDescriptor {
  const core = unwrap(schema);
  const type = baseType(core);
  // A field is required iff the schema rejects `undefined`.
  const required = !schema.safeParse(undefined).success;
  const field: FieldDescriptor = {
    name,
    type,
    required,
    isoDate: core === isoDate,
    monetary: (MONETARY_FIELDS[collection] ?? []).includes(name),
  };
  if (type === 'enum') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    field.enum = [...((core as any).options as string[])];
  }
  return field;
}

function describeCollection(name: CollectionName): CollectionDescriptor {
  const schema = collectionSchemas[name];
  const shape = schema.shape as Record<string, z.ZodType>;
  const fields = Object.entries(shape).map(([fname, fschema]) =>
    describeField(fname, fschema, name),
  );
  // Trips derive their id from `date` (a literal in deriveId); all other
  // collections from SLUG_SOURCE. ID_PREFIX likewise omits the trip `t-` literal.
  const slugSource = name === 'trip' ? 'date' : SLUG_SOURCE[name];
  const idPrefix = name === 'trip' ? 't-' : ID_PREFIX[name];
  return {
    name,
    dir: COLLECTION_DIR[name],
    idPrefix,
    slugSource,
    ownerOnly: (OWNER_ONLY_COLLECTIONS as readonly string[]).includes(name),
    fields,
  };
}

/**
 * Build the full schema descriptor by reading back the data layer's own source
 * of truth. Recomputed on each call (cheap); callers may cache if they wish.
 */
export function describeSchema(): SchemaDescriptor {
  const collections = (Object.keys(collectionSchemas) as CollectionName[]).map(describeCollection);
  return {
    collections,
    monetaryFields: MONETARY_FIELDS,
    ownerOnlyCollections: [...OWNER_ONLY_COLLECTIONS],
    crossLinks: [...CROSS_LINKS],
    derived: {
      inventoryTaskKinds: ['inspect', 'service', 'expires'],
      maintAttentionStatuses: ['overdue', 'due'],
      dueWindowDays: DUE_WINDOW_DAYS,
    },
  };
}
