import { describe, it, expect, vi } from 'vitest';
import { fetchTides } from '../../src/server/conditions/tides.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const STATIONS = [
  { id: '8665530', name: 'Charleston', primary: true },
  { id: '8665543', name: 'Wando' },
];

describe('fetchTides', () => {
  it('fetches hi/lo predictions per station and normalizes shape', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const station = new URL(String(url)).searchParams.get('station');
      return jsonResponse({
        predictions: [
          { t: '2026-06-20 15:12', v: station === '8665530' ? '5.8' : '5.6', type: 'H' },
          { t: '2026-06-20 21:30', v: '0.4', type: 'L' },
        ],
      });
    }) as unknown as typeof globalThis.fetch;

    const out = await fetchTides(fetchImpl, STATIONS, '20260620');
    expect(Object.keys(out)).toEqual(['8665530', '8665543']);
    expect(out['8665530']?.[0]).toEqual({ type: 'H', time: '2026-06-20T15:12:00Z', heightFt: 5.8 });
    expect(out['8665530']?.[1]?.type).toBe('L');
    expect(out['8665543']?.[0]?.heightFt).toBe(5.6);
  });

  it('degrades a single failing station to an empty array', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const station = new URL(String(url)).searchParams.get('station');
      if (station === '8665543') return jsonResponse({}, false, 500);
      return jsonResponse({ predictions: [{ t: '2026-06-20 15:12', v: '5.8', type: 'H' }] });
    }) as unknown as typeof globalThis.fetch;

    const out = await fetchTides(fetchImpl, STATIONS, '20260620');
    expect(out['8665530']).toHaveLength(1);
    expect(out['8665543']).toEqual([]);
  });

  it('throws when every station fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500)) as unknown as typeof globalThis.fetch;
    await expect(fetchTides(fetchImpl, STATIONS, '20260620')).rejects.toThrow(/all tide stations failed/);
  });

  it('URL-encodes a begin_date that carries a time component', async () => {
    let url = '';
    const fetchImpl = vi.fn(async (u: string) => {
      url = String(u);
      return jsonResponse({ predictions: [] });
    }) as unknown as typeof globalThis.fetch;
    // A now-based begin_date includes a time ("YYYYMMDD HH:MM"); the space + colon
    // must be percent-encoded or the request URL is malformed.
    await fetchTides(fetchImpl, [{ id: '8665530', name: 'Charleston', primary: true }], '20260622 13:34');
    expect(url).toContain('begin_date=20260622%2013%3A34');
    expect(url).not.toContain('begin_date=20260622 13:34');
  });
});
