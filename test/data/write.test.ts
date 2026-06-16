import { describe, it, expect } from 'vitest';
import {
  recordPath, slugify, deriveId, toFileContents, createSchemas, parseRecord,
} from '../../src/data/index.js';

describe('recordPath', () => {
  it('maps a collection + id to its repo-relative file path', () => {
    expect(recordPath('trip', 't-2024-06-22')).toBe('trips/t-2024-06-22.md');
    expect(recordPath('maintenance', 'm-jib')).toBe('maintenance/m-jib.md');
    expect(recordPath('cost', 'c-x')).toBe('costs/c-x.md');
    expect(recordPath('vendor', 'v-x')).toBe('vendors/v-x.md');
    expect(recordPath('inventory', 'inv-x')).toBe('inventory/inv-x.md');
    expect(recordPath('manual', 'man-x')).toBe('manuals/man-x.md');
  });
});

describe('slugify', () => {
  it('lowercases, hyphenates, and strips punctuation', () => {
    expect(slugify('Replace Frayed Jib Halyard')).toBe('replace-frayed-jib-halyard');
    expect(slugify('  Engine  Oil & Filter!! ')).toBe('engine-oil-filter');
    expect(slugify('***')).toBe('');
  });
});

describe('deriveId', () => {
  it('derives a trip id from its date, suffixing on collision', () => {
    expect(deriveId('trip', { date: '2024-07-01' }, new Set())).toBe('t-2024-07-01');
    const taken = new Set(['t-2024-06-22']);
    expect(deriveId('trip', { date: '2024-06-22' }, taken)).toBe('t-2024-06-22-2');
    taken.add('t-2024-06-22-2');
    expect(deriveId('trip', { date: '2024-06-22' }, taken)).toBe('t-2024-06-22-3');
  });

  it('derives a slug id from the right source field per collection', () => {
    expect(deriveId('maintenance', { title: 'Replace Jib Halyard' }, new Set())).toBe('m-replace-jib-halyard');
    expect(deriveId('vendor', { name: 'Sail Loft' }, new Set())).toBe('v-sail-loft');
    expect(deriveId('inventory', { name: 'Flares' }, new Set())).toBe('inv-flares');
    expect(deriveId('cost', { item: 'New Halyard' }, new Set())).toBe('c-new-halyard');
    expect(deriveId('manual', { title: 'Engine' }, new Set())).toBe('man-engine');
  });

  it('suffixes a slug id on collision', () => {
    expect(deriveId('vendor', { name: 'Sail Loft' }, new Set(['v-sail-loft']))).toBe('v-sail-loft-2');
  });

  it('throws when a non-trip source slugs to empty', () => {
    expect(() => deriveId('vendor', { name: '***' }, new Set())).toThrow();
  });
});

describe('toFileContents', () => {
  it('round-trips: body is excluded from frontmatter and restored on parse', () => {
    const file = toFileContents({ id: 't-2024-07-01', date: '2024-07-01', title: 'Sail', body: 'Lovely day.' });
    const { data, body } = parseRecord(file);
    expect(data).toEqual({ id: 't-2024-07-01', date: '2024-07-01', title: 'Sail' });
    expect(body).toBe('Lovely day.');
    expect(file).not.toContain('body:'); // body must never leak into YAML frontmatter
  });
});

describe('createSchemas', () => {
  it('validates create input without requiring an id', () => {
    expect(createSchemas.trip.safeParse({ date: '2024-07-01' }).success).toBe(true);
    expect(createSchemas.trip.safeParse({ date: 'nope' }).success).toBe(false);
    expect(createSchemas.vendor.safeParse({ name: 'Sail Loft' }).success).toBe(true);
    expect(createSchemas.vendor.safeParse({}).success).toBe(false); // name required
  });
});
