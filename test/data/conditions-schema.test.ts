import { describe, it, expect } from 'vitest';
import { conditionsSchema } from '../../src/data/schema.js';

describe('conditionsSchema', () => {
  it('accepts a full agent-mode record (location + readings)', () => {
    const r = conditionsSchema.parse({
      source: 'agent',
      location: { label: 'Charleston Harbor', lat: 32.78, lon: -79.93, asOf: '2026-06-20T13:00:00Z' },
      weather: {
        asOf: '2026-06-20T13:05:00Z',
        source: 'NWS AMZ330',
        summary: 'SW 10-15 kt',
        periods: [{ time: '2026-06-20T14:00:00Z', windDir: 'SW', windKt: 12, gustKt: 18, tempF: 84, seasFt: 2.5, sky: 'Partly cloudy', precipPct: 10 }],
      },
      tides: {
        stations: [{ id: '8665530', name: 'Charleston', area: 'Charleston Harbor', primary: true }],
        predictions: { '8665530': [{ type: 'H', time: '2026-06-20T15:12:00Z', heightFt: 5.8 }] },
      },
    }) as any;
    expect(r.source).toBe('agent');
    expect(r.tides.predictions['8665530'][0].type).toBe('H');
  });

  it('accepts an api-mode config-only record (no readings)', () => {
    const r = conditionsSchema.parse({
      source: 'api',
      location: { label: 'Charleston', lat: 32.78, lon: -79.93 },
      tides: { stations: [{ id: '8665530', name: 'Charleston', primary: true }] },
    });
    expect(r.source).toBe('api');
    expect(r.weather).toBeUndefined();
    expect(r.tides?.predictions).toBeUndefined();
  });

  it('requires source and location', () => {
    expect(conditionsSchema.safeParse({ source: 'api' }).success).toBe(false);
    expect(conditionsSchema.safeParse({ location: { label: 'x', lat: 1, lon: 2 } }).success).toBe(false);
  });

  it('rejects an unknown source and a non-H/L tide type', () => {
    expect(conditionsSchema.safeParse({ source: 'manual', location: { label: 'x', lat: 1, lon: 2 } }).success).toBe(false);
    expect(conditionsSchema.safeParse({
      source: 'agent',
      location: { label: 'x', lat: 1, lon: 2 },
      tides: { predictions: { s: [{ type: 'X', time: 't' }] } },
    }).success).toBe(false);
  });
});
