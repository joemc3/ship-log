import type { Dataset } from './dataset.js';
import type { CollectionName } from './write.js';

export interface BrokenLink {
  from: string;   // source record id
  field: string;  // which reference field
  target: string; // the missing target id
}

/**
 * Every cross-record reference in the data model, as a single declarative table.
 * `from`/`target` are collection (singular) names; `field` is the reference
 * field's path on the source record (`findings.maintId` denotes the per-finding
 * `maintId` inside a trip's `findings[]`). This is the one source of truth for
 * cross-links: `checkLinkIntegrity` validates against it and `describe.ts`
 * surfaces it to the Cowork docs, so the two can never drift.
 */
export interface CrossLink {
  from: CollectionName;
  field: string;
  target: CollectionName;
}

export const CROSS_LINKS: readonly CrossLink[] = [
  { from: 'trip', field: 'findings.maintId', target: 'maintenance' },
  { from: 'maintenance', field: 'vendorId', target: 'vendor' },
  { from: 'maintenance', field: 'fromTripId', target: 'trip' },
  { from: 'cost', field: 'vendorId', target: 'vendor' },
  { from: 'cost', field: 'maintId', target: 'maintenance' },
] as const;

export function checkLinkIntegrity(ds: Dataset): BrokenLink[] {
  const has = {
    trip: new Set(ds.trips.map((t) => t.id)),
    maintenance: new Set(ds.maintenance.map((m) => m.id)),
    vendor: new Set(ds.vendors.map((v) => v.id)),
  };
  const broken: BrokenLink[] = [];
  const check = (cond: boolean, from: string, field: string, target: string) => {
    if (!cond) broken.push({ from, field, target });
  };

  for (const t of ds.trips) {
    for (const f of t.findings ?? []) {
      if (f.maintId) check(has.maintenance.has(f.maintId), t.id, 'findings.maintId', f.maintId);
    }
  }
  for (const m of ds.maintenance) {
    if (m.vendorId) check(has.vendor.has(m.vendorId), m.id, 'vendorId', m.vendorId);
    if (m.fromTripId) check(has.trip.has(m.fromTripId), m.id, 'fromTripId', m.fromTripId);
  }
  for (const c of ds.costs) {
    if (c.vendorId) check(has.vendor.has(c.vendorId), c.id, 'vendorId', c.vendorId);
    if (c.maintId) check(has.maintenance.has(c.maintId), c.id, 'maintId', c.maintId);
  }
  return broken;
}
