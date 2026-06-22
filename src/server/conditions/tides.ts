import type { TidePrediction, TideStation } from '../../data/schema.js';

const TIDES_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const UA = 'ShipsLog/1.0 (+conditions)';

interface CoOpsJson {
  predictions?: { t: string; v: string; type: string }[];
}

/** Fetch 48h of high/low tide predictions per station from NOAA CO-OPS (free,
 *  no key, US-only). `startDate` is a NOAA `begin_date` in GMT — either
 *  `YYYYMMDD` or `YYYYMMDD HH:MM`; the caller passes "now" (with the time) so the
 *  list runs from now forward, not from midnight. Each station is fetched
 *  independently; a station that errors (throws or `!res.ok`) yields an empty
 *  list rather than failing the whole board — UNLESS every station fails, in
 *  which case this throws so callers can distinguish "total failure" from
 *  "stations legitimately empty" (an `res.ok` empty `predictions` array is a
 *  success, not a failure). */
export async function fetchTides(
  fetchImpl: typeof globalThis.fetch,
  stations: TideStation[],
  startDate: string,
): Promise<Record<string, TidePrediction[]>> {
  const results = await Promise.all(
    stations.map(async (st): Promise<{ id: string; preds: TidePrediction[]; failed: boolean }> => {
      const url =
        `${TIDES_URL}?product=predictions&application=shiplog&begin_date=${encodeURIComponent(startDate)}` +
        `&range=48&datum=MLLW&interval=hilo&units=english&time_zone=gmt&format=json&station=${encodeURIComponent(st.id)}`;
      try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) return { id: st.id, preds: [], failed: true };
        const json = (await res.json()) as CoOpsJson;
        const preds = (json.predictions ?? []).map((p) => ({
          type: p.type === 'L' ? ('L' as const) : ('H' as const),
          // NOAA returns "YYYY-MM-DD HH:MM" (gmt) with no seconds.
          time: `${p.t.replace(' ', 'T')}:00Z`,
          heightFt: Number(p.v),
        }));
        return { id: st.id, preds, failed: false };
      } catch {
        return { id: st.id, preds: [], failed: true };
      }
    }),
  );

  if (stations.length > 0 && results.every((r) => r.failed)) {
    throw new Error('all tide stations failed');
  }

  const out: Record<string, TidePrediction[]> = {};
  for (const r of results) out[r.id] = r.preds;
  return out;
}
