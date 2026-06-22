import { describe, it, expect, vi } from 'vitest';
import { createConditionsService } from '../../src/server/conditions/service.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const FORECAST = {
  hourly: {
    time: ['2026-06-20T14:00'], temperature_2m: [84], wind_speed_10m: [12],
    wind_gusts_10m: [18], wind_direction_10m: [225], precipitation_probability: [10], weather_code: [2],
  },
};
const TIDES = { predictions: [{ t: '2026-06-20 15:12', v: '5.8', type: 'H' }] };

function stubFetch(): { fn: typeof globalThis.fetch; counts: { weather: number; tides: number } } {
  const counts = { weather: 0, tides: 0 };
  const fn = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('tidesandcurrents')) { counts.tides += 1; return jsonResponse(TIDES); }
    if (u.includes('marine-api')) return jsonResponse({ hourly: { time: ['2026-06-20T14:00'], wave_height: [2.5] } });
    counts.weather += 1; return jsonResponse(FORECAST);
  }) as unknown as typeof globalThis.fetch;
  return { fn, counts };
}

const INPUT = {
  location: { label: 'x', lat: 1, lon: 2 },
  stations: [{ id: '8665530', name: 'Charleston', primary: true }],
};

describe('conditions service cache', () => {
  it('fetches on first call and serves from cache within TTL', async () => {
    let nowMs = Date.parse('2026-06-20T16:00:00Z');
    const { fn, counts } = stubFetch();
    const svc = createConditionsService({ fetch: fn, now: () => new Date(nowMs) });

    const a = await svc.get(INPUT);
    expect(a.periods).toHaveLength(1);
    expect(a.predictions['8665530']).toHaveLength(1);
    expect(counts.weather).toBe(1);
    expect(counts.tides).toBe(1);

    nowMs += 10 * 60_000; // +10 min, within both TTLs
    await svc.get(INPUT);
    expect(counts.weather).toBe(1); // no refetch
    expect(counts.tides).toBe(1);
  });

  it('refetches weather after its TTL but keeps tides cached longer', async () => {
    let nowMs = Date.parse('2026-06-20T16:00:00Z');
    const { fn, counts } = stubFetch();
    const svc = createConditionsService({ fetch: fn, now: () => new Date(nowMs) });
    await svc.get(INPUT);
    nowMs += 31 * 60_000; // past 30-min weather TTL, under 6-h tides TTL
    await svc.get(INPUT);
    expect(counts.weather).toBe(2);
    expect(counts.tides).toBe(1);
  });

  it('serves last-good and flags errored when a refetch fails', async () => {
    let nowMs = Date.parse('2026-06-20T16:00:00Z');
    let failWeather = false;
    const counts = { weather: 0 };
    const fn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('tidesandcurrents')) return jsonResponse(TIDES);
      if (u.includes('marine-api')) return jsonResponse({ hourly: { time: ['2026-06-20T14:00'], wave_height: [2.5] } });
      counts.weather += 1;
      if (failWeather) return jsonResponse({}, false, 500);
      return jsonResponse(FORECAST);
    }) as unknown as typeof globalThis.fetch;
    const svc = createConditionsService({ fetch: fn, now: () => new Date(nowMs) });

    const a = await svc.get(INPUT);
    expect(a.errored).toBe(false);
    nowMs += 31 * 60_000;
    failWeather = true;
    const b = await svc.get(INPUT);
    expect(b.errored).toBe(true);
    expect(b.periods).toHaveLength(1); // last-good still served
  });

  it('reports unavailable when nothing can be fetched and there is no cache', async () => {
    const fn = vi.fn(async () => jsonResponse({}, false, 500)) as unknown as typeof globalThis.fetch;
    const svc = createConditionsService({ fetch: fn, now: () => new Date('2026-06-20T16:00:00Z') });
    const r = await svc.get(INPUT);
    expect(r.error).toBe('unavailable');
    expect(r.periods).toEqual([]);
    expect(r.asOf).toBeUndefined();
  });

  it('fetches tides starting at "now" (begin_date carries the current date + time)', async () => {
    let tidesUrl = '';
    const fn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('tidesandcurrents')) { tidesUrl = u; return jsonResponse(TIDES); }
      if (u.includes('marine-api')) return jsonResponse({ hourly: { time: ['2026-06-22T14:00'], wave_height: [2.5] } });
      return jsonResponse(FORECAST);
    }) as unknown as typeof globalThis.fetch;
    const svc = createConditionsService({ fetch: fn, now: () => new Date('2026-06-22T13:34:00Z') });
    await svc.get(INPUT);
    // begin_date must reflect now (date + time, percent-encoded), not midnight-only.
    expect(tidesUrl).toContain('begin_date=20260622%2013%3A34');
  });
});
