import type { Dataset } from '../data/index.js';
import { MONETARY_FIELDS, OWNER_ONLY_COLLECTIONS } from '../data/index.js';

export type Role = 'owner' | 'crew' | 'guest';

// Map a monetary-registry collection key (singular) to its Dataset array property.
// All values are array-typed Dataset keys; `boat` and `quickref` are intentionally
// absent (not record collections). This is why the `as Array<...>` cast below is sound.
export const DATASET_KEY: Record<string, keyof Dataset> = {
  trip: 'trips',
  maintenance: 'maintenance',
  cost: 'costs',
  vendor: 'vendors',
  inventory: 'inventory',
  manual: 'manuals',
};

/**
 * Return a role-scoped VIEW of the dataset. Owners get the original reference;
 * crew/guest get a deep copy with owner-only collections emptied and every
 * monetary field stripped — so the value never reaches a response, the search
 * haystack, or a derived rollup. Authoritative source: src/data/monetary.ts.
 *
 * Monetary fields are assumed to be top-level scalars on each record; a future
 * nested cost object would require a recursive strip.
 */
export function redactDataset(ds: Dataset, role: Role): Dataset {
  if (role === 'owner') return ds;
  const view = structuredClone(ds);

  for (const collection of OWNER_ONLY_COLLECTIONS) {
    const key = DATASET_KEY[collection];
    if (key && Array.isArray(view[key])) (view[key] as unknown[]).length = 0;
  }

  for (const [collection, fields] of Object.entries(MONETARY_FIELDS)) {
    if ((OWNER_ONLY_COLLECTIONS as readonly string[]).includes(collection)) continue;
    const key = DATASET_KEY[collection];
    if (!key) continue;
    for (const record of view[key] as Array<Record<string, unknown>>) {
      for (const f of fields) delete record[f];
    }
  }
  return view;
}
