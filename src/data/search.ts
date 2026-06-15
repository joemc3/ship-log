import type { Dataset } from './dataset.js';

export interface SearchHit {
  collection: 'trip' | 'maintenance' | 'cost' | 'vendor' | 'inventory' | 'manual';
  id: string;
  title: string;
}

/**
 * Flatten a record's VALUES (not its field names) into one lowercased haystack.
 * We deliberately drop top-level keys so a query like "id" or "vendorid" doesn't
 * match every record by field name. (Nested-object keys are still included via
 * JSON.stringify of object values — acceptable for this simple search.)
 */
function haystack(record: Record<string, unknown>): string {
  return Object.values(record)
    .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')))
    .join(' ')
    .toLowerCase();
}

export function search(ds: Dataset, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const scan = (
    collection: SearchHit['collection'],
    records: Array<Record<string, unknown> & { id: string }>,
    titleOf: (r: any) => string,
  ) => {
    for (const r of records) {
      if (haystack(r).includes(q)) hits.push({ collection, id: r.id, title: titleOf(r) });
    }
  };
  scan('trip', ds.trips, (r) => r.title ?? r.id);
  scan('maintenance', ds.maintenance, (r) => r.title);
  scan('cost', ds.costs, (r) => r.item);
  scan('vendor', ds.vendors, (r) => r.name);
  scan('inventory', ds.inventory, (r) => r.name);
  scan('manual', ds.manuals, (r) => r.title);
  return hits;
}
