import { describe, it, expect } from 'vitest';
import { describeSchema, type FieldDescriptor } from '../../src/data/describe.js';
import { COLLECTION_DIR } from '../../src/data/write.js';
import { MONETARY_FIELDS, OWNER_ONLY_COLLECTIONS } from '../../src/data/monetary.js';
import { DUE_WINDOW_DAYS } from '../../src/data/derive.js';

const desc = describeSchema();

describe('describeSchema — collections', () => {
  it('lists every per-record collection exactly once', () => {
    const names = desc.collections.map((c) => c.name).sort();
    expect(names).toEqual(['cost', 'inventory', 'maintenance', 'manual', 'trip', 'vendor']);
  });

  it('maps each collection to its on-disk dir from COLLECTION_DIR (not hand-transcribed)', () => {
    for (const c of desc.collections) {
      expect(c.dir).toBe(COLLECTION_DIR[c.name]);
    }
    expect(desc.collections.find((c) => c.name === 'trip')!.dir).toBe('trips');
    expect(desc.collections.find((c) => c.name === 'cost')!.dir).toBe('costs');
    expect(desc.collections.find((c) => c.name === 'inventory')!.dir).toBe('inventory');
  });

  it('records the id prefix per collection', () => {
    const prefix = (n: string) => desc.collections.find((c) => c.name === n)!.idPrefix;
    expect(prefix('trip')).toBe('t-');
    expect(prefix('maintenance')).toBe('m-');
    expect(prefix('cost')).toBe('c-');
    expect(prefix('vendor')).toBe('v-');
    expect(prefix('inventory')).toBe('inv-');
    expect(prefix('manual')).toBe('man-');
  });

  it('records the slug-source field per collection (trips derive from date)', () => {
    const slug = (n: string) => desc.collections.find((c) => c.name === n)!.slugSource;
    expect(slug('trip')).toBe('date');
    expect(slug('maintenance')).toBe('title');
    expect(slug('cost')).toBe('item');
    expect(slug('vendor')).toBe('name');
    expect(slug('inventory')).toBe('name');
    expect(slug('manual')).toBe('title');
  });
});

describe('describeSchema — fields', () => {
  /** Field accessor for a collection that throws (fails the test) on an unknown
   *  field name, so the returned descriptor is never `undefined`. */
  const fieldOf = (n: string) => {
    const coll = desc.collections.find((c) => c.name === n)!;
    return (field: string): FieldDescriptor => {
      const f = coll.fields.find((x) => x.name === field);
      if (!f) throw new Error(`no field ${field} on ${n}`);
      return f;
    };
  };

  it('derives the full field list from the Zod schema (trip)', () => {
    const names = desc.collections.find((c) => c.name === 'trip')!.fields.map((f) => f.name);
    expect([...names].sort()).toEqual(
      [
        'crew', 'date', 'distanceNm', 'durationHrs', 'engineHrs', 'findings',
        'id', 'photos', 'seas', 'sky', 'tempF', 'title', 'waypoints', 'wind',
      ].sort(),
    );
  });

  it('marks required vs optional from the Zod schema', () => {
    const t = fieldOf('trip');
    expect(t('id').required).toBe(true);
    expect(t('date').required).toBe(true);
    expect(t('title').required).toBe(false);
    expect(t('crew').required).toBe(false);

    const m = fieldOf('maintenance');
    expect(m('title').required).toBe(true);
    expect(m('status').required).toBe(true);
    expect(m('costEst').required).toBe(false);

    const c = fieldOf('cost');
    expect(c('item').required).toBe(true);
    expect(c('amount').required).toBe(true);
    expect(c('category').required).toBe(false);
  });

  it('surfaces enums with their exact option list', () => {
    const status = fieldOf('maintenance')('status');
    expect(status.type).toBe('enum');
    expect(status.enum).toEqual(['overdue', 'due', 'scheduled', 'done']);
  });

  it('flags isoDate fields (including through optional/nullable wrappers)', () => {
    const t = fieldOf('trip');
    expect(t('date').isoDate).toBe(true);
    const m = fieldOf('maintenance');
    expect(m('due').isoDate).toBe(true);
    expect(m('completed').isoDate).toBe(true); // optional + nullable wrapped
    expect(m('title').isoDate).toBe(false);
    const inv = fieldOf('inventory');
    expect(inv('inspect').isoDate).toBe(true);
    expect(inv('service').isoDate).toBe(true);
    expect(inv('expires').isoDate).toBe(true);
  });

  it('records base types for scalars and arrays', () => {
    const t = fieldOf('trip');
    expect(t('title').type).toBe('string');
    expect(t('durationHrs').type).toBe('number');
    expect(t('crew').type).toBe('array');
    expect(t('waypoints').type).toBe('array');
    expect(t('findings').type).toBe('array');
  });

  it('flags monetary fields inline on the field record', () => {
    const m = fieldOf('maintenance');
    expect(m('costEst').monetary).toBe(true);
    expect(m('title').monetary).toBe(false);
    const c = fieldOf('cost');
    expect(c('amount').monetary).toBe(true);
    expect(c('item').monetary).toBe(false);
  });
});

describe('describeSchema — monetary / owner-only', () => {
  it('mirrors MONETARY_FIELDS from monetary.ts exactly', () => {
    expect(desc.monetaryFields).toEqual(MONETARY_FIELDS);
    expect(desc.monetaryFields.maintenance).toEqual(['costEst']);
    expect(desc.monetaryFields.cost).toEqual(['amount']);
  });

  it('mirrors OWNER_ONLY_COLLECTIONS from monetary.ts exactly', () => {
    expect(desc.ownerOnlyCollections).toEqual([...OWNER_ONLY_COLLECTIONS]);
    expect(desc.ownerOnlyCollections).toContain('cost');
  });

  it('marks owner-only collections inline on the collection record', () => {
    const ownerOnly = desc.collections.filter((c) => c.ownerOnly).map((c) => c.name);
    expect(ownerOnly).toEqual(['cost']);
  });

  it('every declared monetary field exists on its collection schema', () => {
    for (const [coll, fields] of Object.entries(desc.monetaryFields)) {
      const known = desc.collections.find((c) => c.name === coll)!.fields.map((f) => f.name);
      for (const field of fields) expect(known).toContain(field);
    }
  });
});

describe('describeSchema — cross-links', () => {
  it('lists every cross-link field with its source collection, field path, and target collection', () => {
    // order-independent comparison
    const got = [...desc.crossLinks].sort((a, b) =>
      (a.from + a.field).localeCompare(b.from + b.field),
    );
    expect(got).toEqual(
      [
        { from: 'trip', field: 'findings.maintId', target: 'maintenance' },
        { from: 'maintenance', field: 'vendorId', target: 'vendor' },
        { from: 'maintenance', field: 'fromTripId', target: 'trip' },
        { from: 'cost', field: 'vendorId', target: 'vendor' },
        { from: 'cost', field: 'maintId', target: 'maintenance' },
      ].sort((a, b) => (a.from + a.field).localeCompare(b.from + b.field)),
    );
  });
});

describe('describeSchema — derived tasks', () => {
  it('lists the inventory date fields that drive derived tasks', () => {
    expect(desc.derived.inventoryTaskKinds).toEqual(['inspect', 'service', 'expires']);
  });

  it('lists the maintenance statuses that count as needing attention', () => {
    expect(desc.derived.maintAttentionStatuses).toEqual(['overdue', 'due']);
  });

  it('surfaces the due window from derive.ts (not hand-transcribed)', () => {
    expect(desc.derived.dueWindowDays).toBe(DUE_WINDOW_DAYS);
  });
});
