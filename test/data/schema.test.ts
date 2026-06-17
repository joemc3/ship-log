import { describe, it, expect } from 'vitest';
import { isoDate, tripSchema, maintenanceSchema, costSchema, vendorSchema, inventorySchema, manualSchema, quickrefSchema, boatSchema } from '../../src/data/schema.js';

describe('tripSchema', () => {
  it('accepts a fully populated trip', () => {
    const trip = {
      id: 't-2024-06-22', title: 'Shakedown to Gull Point', date: '2024-06-22',
      durationHrs: 5.5, crew: ['Skipper', 'Dana R.'],
      waypoints: [{ name: 'Marina', type: 'depart', time: '10:15', note: 'Motored out' }],
      findings: [{ text: 'Jib halyard frayed.', severity: 'high', maintId: 'm-jib-halyard' }],
      photos: ['photos/t-2024-06-22-01.jpg'],
    };
    expect(tripSchema.parse(trip)).toMatchObject({ id: 't-2024-06-22' });
  });

  it('accepts a partial-but-valid trip (only id + date; narrative lives in the body)', () => {
    expect(() => tripSchema.parse({ id: 't-2024-07-01', date: '2024-07-01' })).not.toThrow();
  });

  it('rejects a trip missing the required date', () => {
    expect(() => tripSchema.parse({ id: 't-2024-07-01' })).toThrow();
  });

  it('rejects a bad waypoint type', () => {
    const bad = { id: 't-2024-07-01', date: '2024-07-01', waypoints: [{ name: 'X', type: 'teleport' }] };
    expect(() => tripSchema.parse(bad)).toThrow();
  });

  it('rejects a trip id with trailing garbage', () => {
    expect(() => tripSchema.parse({ id: 't-2024-06-22xyz', date: '2024-06-22' })).toThrow();
  });

  it('accepts a same-day suffixed trip id', () => {
    expect(() => tripSchema.parse({ id: 't-2024-06-22-pm', date: '2024-06-22' })).not.toThrow();
  });
});

describe('maintenanceSchema', () => {
  it('accepts a full maintenance item with a cost estimate', () => {
    const m = {
      id: 'm-jib-halyard', title: 'Replace frayed jib halyard', system: 'Rigging',
      status: 'overdue', priority: 1, opened: '2024-06-22', due: '2024-06-30',
      completed: null, costEst: 95, vendorId: 'v-sailloft', fromTripId: 't-2024-06-22',
    };
    expect(maintenanceSchema.parse(m)).toMatchObject({ status: 'overdue', costEst: 95 });
  });

  it('accepts a partial item (id + title + status only)', () => {
    expect(() => maintenanceSchema.parse({ id: 'm-x', title: 'Check bilge', status: 'scheduled' })).not.toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => maintenanceSchema.parse({ id: 'm-x', title: 'X', status: 'maybe' })).toThrow();
  });
});

describe('costSchema', () => {
  it('accepts a cost record', () => {
    const c = { id: 'c-jib-halyard', date: '2024-07-02', category: 'Rigging', item: 'New halyard line', amount: 92.5, vendorId: 'v-sailloft', maintId: 'm-jib-halyard' };
    expect(costSchema.parse(c)).toMatchObject({ amount: 92.5 });
  });

  it('requires item and amount', () => {
    expect(() => costSchema.parse({ id: 'c-x', date: '2024-07-02' })).toThrow();
  });
});

describe('vendorSchema', () => {
  it('accepts a vendor with services', () => {
    const v = { id: 'v-sailloft', name: 'The Sail Loft', phone: '555-0100', services: ['rigging', 'sails'] };
    expect(vendorSchema.parse(v)).toMatchObject({ name: 'The Sail Loft' });
  });

  it('requires id and name', () => {
    expect(() => vendorSchema.parse({ id: 'v-x' })).toThrow();
  });
});

describe('inventorySchema', () => {
  it('accepts an inventory item with tracking dates', () => {
    const inv = { id: 'inv-flares', name: 'Handheld flares', category: 'Safety', count: 6, expires: '2025-08-01', condition: 'good' };
    expect(inventorySchema.parse(inv)).toMatchObject({ id: 'inv-flares' });
  });

  it('accepts a partial item (id + name only)', () => {
    expect(() => inventorySchema.parse({ id: 'inv-x', name: 'Spare shackles' })).not.toThrow();
  });
});

describe('isoDate', () => {
  it('accepts a real calendar date', () => {
    expect(() => isoDate.parse('2024-06-30')).not.toThrow();
  });

  it('rejects an impossible month (2024-13-01)', () => {
    expect(() => isoDate.parse('2024-13-01')).toThrow();
  });

  it('rejects an impossible day (2024-06-32)', () => {
    expect(() => isoDate.parse('2024-06-32')).toThrow();
  });

  it('rejects a datetime string (2024-06-30T00:00:00Z)', () => {
    expect(() => isoDate.parse('2024-06-30T00:00:00Z')).toThrow();
  });
});

describe('ISO-date refinement', () => {
  it('rejects a non-ISO trip date', () => {
    expect(() => tripSchema.parse({ id: 't-2024-07-01', date: 'July 1 2024' })).toThrow();
  });

  it('rejects a non-ISO maintenance due date', () => {
    expect(() => maintenanceSchema.parse({ id: 'm-x', title: 'X', status: 'due', due: '2024/06/30' })).toThrow();
  });

  it('rejects a non-ISO inventory expiry', () => {
    expect(() => inventorySchema.parse({ id: 'inv-x', name: 'Flares', expires: 'soon' })).toThrow();
  });

  it('still accepts valid ISO dates and a null completed', () => {
    expect(() => maintenanceSchema.parse({ id: 'm-x', title: 'X', status: 'done', opened: '2024-06-22', due: '2024-06-30', completed: null })).not.toThrow();
  });
});

describe('manual/quickref/boat schemas', () => {
  it('accepts a manual with sections and a file ref', () => {
    const man = { id: 'man-engine', title: 'Universal M-25 Manual', kind: 'engine', file: 'manuals/m25.pdf', sections: [{ title: 'Winterizing', anchor: 'winterize' }] };
    expect(manualSchema.parse(man)).toMatchObject({ id: 'man-engine' });
  });

  it('accepts a quickref list', () => {
    const qr = [{ id: 'qr-reef', title: 'Reefing the main', body: 'Ease the halyard…' }];
    expect(quickrefSchema.parse(qr)).toHaveLength(1);
  });

  it('accepts boat identity + welcome content', () => {
    const boat = { name: 'Valkyrie', make: 'Catalina', model: '25', year: 1985, welcome: { rules: ['Life jackets on deck'], whatToBring: ['Soft-soled shoes'] } };
    expect(boatSchema.parse(boat)).toMatchObject({ name: 'Valkyrie' });
  });

  it('accepts a boat with an optional heroPhoto (a repo-relative photo path)', () => {
    const boat = { name: 'Valkyrie', heroPhoto: 'photos/boat-hero.jpg' };
    expect(boatSchema.parse(boat)).toMatchObject({ heroPhoto: 'photos/boat-hero.jpg' });
  });

  it('still accepts a boat with no heroPhoto', () => {
    expect(() => boatSchema.parse({ name: 'Valkyrie' })).not.toThrow();
    expect(boatSchema.parse({ name: 'Valkyrie' }).heroPhoto).toBeUndefined();
  });
});
