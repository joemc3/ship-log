import type { Dataset } from './dataset.js';

export interface BrokenLink {
  from: string;   // source record id
  field: string;  // which reference field
  target: string; // the missing target id
}

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
