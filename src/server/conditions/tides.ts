import type { TidePrediction, TideStation } from '../../data/schema.js';

const TIDES_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const UA = 'ShipsLog/1.0 (+conditions)';

interface CoOpsJson {
  predictions?: { t: string; v: string; type: string }[];
}

/** Fetch 48h of high/low tide predictions per station from NOAA CO-OPS (free,
 *  no key, US-only). `startDate` is YYYYMMDD in GMT. Each station is fetched
 *  independently; a station that errors yields an empty list rather than failing
 *  the whole board. */
export async function fetchTides(
  fetchImpl: typeof globalThis.fetch,
  stations: TideStation[],
  startDate: string,
): Promise<Record<string, TidePrediction[]>> {
  const out: Record<string, TidePrediction[]> = {};
  await Promise.all(
    stations.map(async (st) => {
      const url =
        `${TIDES_URL}?product=predictions&application=shiplog&begin_date=${startDate}` +
        `&range=48&datum=MLLW&interval=hilo&units=english&time_zone=gmt&format=json&station=${encodeURIComponent(st.id)}`;
      try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) { out[st.id] = []; return; }
        const json = (await res.json()) as CoOpsJson;
        out[st.id] = (json.predictions ?? []).map((p) => ({
          type: p.type === 'L' ? 'L' : 'H',
          time: `${p.t.replace(' ', 'T')}:00Z`,
          heightFt: Number(p.v),
        }));
      } catch {
        out[st.id] = [];
      }
    }),
  );
  return out;
}
