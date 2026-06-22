import type { ConditionLocation, TideStation, WeatherPeriod, TidePrediction } from '../../data/schema.js';
import { fetchWeather } from './weather.js';
import { fetchTides } from './tides.js';

export interface ConditionsReadings {
  periods: WeatherPeriod[];
  predictions: Record<string, TidePrediction[]>;
  asOf?: string;     // ISO of the oldest present source fetch; undefined if nothing succeeded
  errored: boolean;  // a refetch failed this call (last-good or empty served)
  error?: string;    // 'unavailable' when no data at all
}

export interface ConditionsService {
  get(input: { location: ConditionLocation; stations: TideStation[] }): Promise<ConditionsReadings>;
}

export interface ConditionsServiceOpts {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  weatherTtlMs?: number;
  tidesTtlMs?: number;
}

const WEATHER_TTL = 30 * 60_000;       // 30 min
const TIDES_TTL = 6 * 60 * 60_000;     // 6 h

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export function createConditionsService(opts: ConditionsServiceOpts = {}): ConditionsService {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? (() => new Date());
  const weatherTtl = opts.weatherTtlMs ?? WEATHER_TTL;
  const tidesTtl = opts.tidesTtlMs ?? TIDES_TTL;

  let weatherCache: { at: number; periods: WeatherPeriod[] } | undefined;
  let tidesCache: { at: number; predictions: Record<string, TidePrediction[]> } | undefined;

  return {
    async get({ location, stations }) {
      const t = now().getTime();
      let errored = false;

      // ---- weather ----
      if (!weatherCache || t - weatherCache.at >= weatherTtl) {
        try {
          const periods = await fetchWeather(fetchImpl, { lat: location.lat, lon: location.lon });
          weatherCache = { at: t, periods };
        } catch {
          errored = true; // keep last-good (weatherCache) if any
        }
      }

      // ---- tides ----
      if (!tidesCache || t - tidesCache.at >= tidesTtl) {
        try {
          const predictions = await fetchTides(fetchImpl, stations, yyyymmdd(now()));
          // Only cache if at least one station returned predictions (empty-on-error doesn't count)
          const hasData = Object.values(predictions).some((arr) => arr.length > 0);
          if (hasData) {
            tidesCache = { at: t, predictions };
          } else {
            errored = true; // keep last-good (tidesCache) if any
          }
        } catch {
          errored = true; // keep last-good (tidesCache) if any
        }
      }

      const periods = weatherCache?.periods ?? [];
      const predictions = tidesCache?.predictions ?? {};
      const ats = [weatherCache?.at, tidesCache?.at].filter((x): x is number => x !== undefined);
      const asOf = ats.length ? new Date(Math.min(...ats)).toISOString() : undefined;
      const error = asOf === undefined ? 'unavailable' : undefined;

      return { periods, predictions, asOf, errored, error };
    },
  };
}
