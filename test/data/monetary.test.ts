import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MONETARY_FIELDS, OWNER_ONLY_COLLECTIONS, isMonetaryField } from '../../src/data/monetary.js';
import { collectionSchemas } from '../../src/data/schema.js';

describe('monetary registry', () => {
  it('marks costEst on maintenance and amount on cost as monetary', () => {
    expect(MONETARY_FIELDS.maintenance).toContain('costEst');
    expect(MONETARY_FIELDS.cost).toContain('amount');
  });

  it('treats the entire cost collection as owner-only', () => {
    expect(OWNER_ONLY_COLLECTIONS).toContain('cost');
  });

  it('isMonetaryField answers per collection', () => {
    expect(isMonetaryField('maintenance', 'costEst')).toBe(true);
    expect(isMonetaryField('maintenance', 'title')).toBe(false);
    expect(isMonetaryField('trip', 'title')).toBe(false);
  });
});

describe('monetary registry stays in sync with schemas', () => {
  it('every monetary field exists in its collection schema', () => {
    for (const [collection, fields] of Object.entries(MONETARY_FIELDS)) {
      const schema = collectionSchemas[collection as keyof typeof collectionSchemas] as z.ZodObject<z.ZodRawShape>;
      expect(schema, `no schema for ${collection}`).toBeDefined();
      const shapeKeys = Object.keys(schema.shape);
      for (const field of fields) {
        expect(shapeKeys, `${collection}.${field} missing from schema`).toContain(field);
      }
    }
  });

  it('registers every cost-bearing-looking field found in the schemas', () => {
    // Heuristic completeness check by field name. Residual limitation: a monetary
    // field with a non-obvious name would not be caught — keep cost field names
    // conventional (cost*/amount/price/paid/fee).
    const MONETARY_NAME = /cost|amount|price|paid|fee/i;
    for (const [collection, schema] of Object.entries(collectionSchemas)) {
      const shapeKeys = Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape);
      for (const key of shapeKeys) {
        if (MONETARY_NAME.test(key)) {
          expect(
            isMonetaryField(collection, key),
            `${collection}.${key} looks monetary but is not in MONETARY_FIELDS`,
          ).toBe(true);
        }
      }
    }
  });
});
