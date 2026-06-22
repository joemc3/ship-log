import { describe, it, expect, vi } from 'vitest';
import { fetchWeather } from '../../src/server/conditions/weather.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const FORECAST = {
  hourly: {
    time: ['2026-06-20T14:00', '2026-06-20T15:00', '2026-06-20T16:00', '2026-06-20T17:00'],
    temperature_2m: [84, 85, 86, 86],
    wind_speed_10m: [12, 13, 14, 14],
    wind_gusts_10m: [18, 19, 20, 20],
    wind_direction_10m: [225, 225, 200, 180],
    precipitation_probability: [10, 10, 20, 30],
    weather_code: [2, 2, 80, 3],
  },
};
const MARINE = {
  hourly: { time: ['2026-06-20T14:00', '2026-06-20T15:00', '2026-06-20T16:00', '2026-06-20T17:00'], wave_height: [2.5, 2.6, 2.7, 2.8] },
};

// A full day of hourly data starting at midnight GMT (mirrors what Open-Meteo
// returns: hourly[0] is 00:00 of the current day in the requested timezone).
const DAY = (() => {
  const time = Array.from({ length: 24 }, (_, h) => `2026-06-22T${String(h).padStart(2, '0')}:00`);
  return {
    hourly: {
      time,
      temperature_2m: time.map(() => 80),
      wind_speed_10m: time.map(() => 10),
      wind_gusts_10m: time.map(() => 15),
      wind_direction_10m: time.map(() => 180),
      precipitation_probability: time.map(() => 5),
      weather_code: time.map(() => 1),
    },
  };
})();

describe('fetchWeather', () => {
  it('merges forecast + marine into normalized periods every 3 hours', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      jsonResponse(String(url).includes('marine-api') ? MARINE : FORECAST),
    ) as unknown as typeof globalThis.fetch;
    const periods = await fetchWeather(fetchImpl, { lat: 32.78, lon: -79.93 }, new Date('2026-06-20T14:00:00Z'));
    // 4 hourly points, step 3 => indices 0 and 3 => 2 periods.
    expect(periods).toHaveLength(2);
    expect(periods[0]!).toMatchObject({ time: '2026-06-20T14:00:00Z', windDir: 'SW', windKt: 12, gustKt: 18, tempF: 84, seasFt: 2.5, sky: 'Partly cloudy', precipPct: 10 });
    expect(periods[1]!.time).toBe('2026-06-20T17:00:00Z');
    expect(periods[1]!.windDir).toBe('S'); // 180deg
  });

  it('omits seasFt when the marine fetch fails but keeps forecast data', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('marine-api') ? jsonResponse({}, false, 500) : jsonResponse(FORECAST),
    ) as unknown as typeof globalThis.fetch;
    const periods = await fetchWeather(fetchImpl, { lat: 1, lon: 2 }, new Date('2026-06-20T14:00:00Z'));
    expect(periods[0]!.seasFt).toBeUndefined();
    expect(periods[0]!.windKt).toBe(12);
  });

  it('throws when the forecast fetch is not ok', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 503)) as unknown as typeof globalThis.fetch;
    await expect(fetchWeather(fetchImpl, { lat: 1, lon: 2 }, new Date('2026-06-20T14:00:00Z'))).rejects.toThrow();
  });

  it('starts the strip at the hour covering "now", not the series start (midnight GMT)', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      jsonResponse(String(url).includes('marine-api') ? { hourly: { time: [], wave_height: [] } } : DAY),
    ) as unknown as typeof globalThis.fetch;
    const now = new Date('2026-06-22T17:27:00Z'); // mid-afternoon; series began at 00:00Z
    const periods = await fetchWeather(fetchImpl, { lat: 32.78, lon: -79.93 }, now);
    // First card is the in-progress hour (17:00Z), NOT the series start (00:00Z).
    expect(periods[0]!.time).toBe('2026-06-22T17:00:00Z');
    // Nothing in the strip predates the current hour.
    expect(periods.every((p) => Date.parse(p.time) >= Date.parse('2026-06-22T17:00:00Z'))).toBe(true);
    // 3-hour spacing preserved.
    expect(periods[1]!.time).toBe('2026-06-22T20:00:00Z');
  });
});
