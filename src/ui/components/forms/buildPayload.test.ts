/**
 * buildPayload is the heart of the form kit: it turns a flat form-state object
 * into the WritePayload the API expects, OMITTING blank optionals (a '' is never
 * sent — partial entries are first-class) and leaving `body` in place for the
 * server to split out. It must coerce declared number/array fields and drop
 * empties so a free-text-only trip ({ date, body }) builds cleanly.
 */
import { describe, it, expect } from 'vitest';
import { buildPayload } from './buildPayload.js';

describe('buildPayload', () => {
  it('a free-text-only trip builds to just { date, body }', () => {
    const out = buildPayload(
      { date: '2026-06-16', title: '', body: 'A quiet evening sail.', distanceNm: '' },
      { numbers: ['distanceNm'] },
    );
    expect(out).toEqual({ date: '2026-06-16', body: 'A quiet evening sail.' });
  });

  it('omits blank-string optionals entirely (never sends "")', () => {
    const out = buildPayload({ date: '2026-06-16', title: '', sky: '   ', wind: 'SW 12' });
    expect(out).toEqual({ date: '2026-06-16', wind: 'SW 12' });
    expect('title' in out).toBe(false);
    expect('sky' in out).toBe(false);
  });

  it('omits an empty body (no narrative) rather than sending an empty string', () => {
    const out = buildPayload({ date: '2026-06-16', body: '' });
    expect(out).toEqual({ date: '2026-06-16' });
    expect('body' in out).toBe(false);
  });

  it('keeps body when present (the server splits it out)', () => {
    const out = buildPayload({ date: '2026-06-16', body: 'narrative' });
    expect(out.body).toBe('narrative');
  });

  it('coerces declared number fields and drops blank ones', () => {
    const out = buildPayload(
      { item: 'Fuel', amount: '42.5', tempF: '', date: '2026-06-16' },
      { numbers: ['amount', 'tempF'] },
    );
    expect(out).toEqual({ item: 'Fuel', amount: 42.5, date: '2026-06-16' });
    expect(typeof out.amount).toBe('number');
  });

  it('keeps a number 0 (a real value, not blank)', () => {
    const out = buildPayload({ engineHrs: '0' }, { numbers: ['engineHrs'] });
    expect(out).toEqual({ engineHrs: 0 });
  });

  it('drops an unparseable number rather than sending NaN', () => {
    const out = buildPayload({ amount: 'not-a-number' }, { numbers: ['amount'] });
    expect('amount' in out).toBe(false);
  });

  it('omits empty arrays and trims/drops blank array members', () => {
    const out = buildPayload(
      { name: 'Sailmaker', services: ['  ', 'canvas', '', 'rigging'], crew: [] },
      { arrays: ['services', 'crew'] },
    );
    expect(out).toEqual({ name: 'Sailmaker', services: ['canvas', 'rigging'] });
    expect('crew' in out).toBe(false);
  });

  it('keeps object-array (repeatable group) entries, dropping fully-empty rows', () => {
    const out = buildPayload(
      {
        date: '2026-06-16',
        waypoints: [
          { name: 'Marina', type: 'depart', time: '', note: '' },
          { name: '', type: 'anchor', time: '', note: '' }, // fully empty-ish → dropped
        ],
      },
      { objectArrays: { waypoints: { keep: ['name'] } } },
    );
    expect(out.waypoints).toEqual([{ name: 'Marina', type: 'depart' }]);
  });

  it('drops boolean false / null / undefined optionals', () => {
    const out = buildPayload({ date: '2026-06-16', vendorId: null, maintId: undefined });
    expect(out).toEqual({ date: '2026-06-16' });
  });

  it('passes through an already-numeric value without re-coercion', () => {
    const out = buildPayload({ amount: 12 }, { numbers: ['amount'] });
    expect(out).toEqual({ amount: 12 });
  });
});
