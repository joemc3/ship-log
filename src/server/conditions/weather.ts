import type { WeatherPeriod } from '../../data/schema.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const UA = 'ShipsLog/1.0 (+conditions)';

const COMPASS: string[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function degToCompass(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8] ?? 'N';
}

// Minimal WMO weather_code -> short sky text. Unknown codes leave sky undefined.
const SKY: Record<number, string> = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  61: 'Rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Snow', 73: 'Snow', 75: 'Snow',
  80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

interface ForecastJson {
  hourly?: {
    time: string[];
    temperature_2m: number[];
    wind_speed_10m: number[];
    wind_gusts_10m: number[];
    wind_direction_10m: number[];
    precipitation_probability: number[];
    weather_code: number[];
  };
}
interface MarineJson {
  hourly?: { time: string[]; wave_height: number[] };
}

/** Fetch + normalize a ~48h marine weather forecast from Open-Meteo (free, no
 *  key, global). Returns up to 16 periods at 3-hour spacing. Throws if the core
 *  forecast call fails; a failed marine (wave) call just drops seasFt. */
export async function fetchWeather(
  fetchImpl: typeof globalThis.fetch,
  location: { lat: number; lon: number },
): Promise<WeatherPeriod[]> {
  const q = `latitude=${location.lat}&longitude=${location.lon}`;
  const fUrl = `${FORECAST_URL}?${q}&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability,weather_code&forecast_days=3&temperature_unit=fahrenheit&wind_speed_unit=kn&timezone=GMT`;
  const mUrl = `${MARINE_URL}?${q}&hourly=wave_height&forecast_days=3&length_unit=imperial&timezone=GMT`;

  const [fRes, mRes] = await Promise.all([
    fetchImpl(fUrl, { headers: { 'User-Agent': UA } }),
    fetchImpl(mUrl, { headers: { 'User-Agent': UA } }),
  ]);

  if (!fRes.ok) throw new Error(`weather forecast fetch failed: ${fRes.status}`);
  const f = (await fRes.json()) as ForecastJson;
  const h = f.hourly;
  if (!h?.time?.length) throw new Error('weather forecast returned no hourly data');

  const waveByTime = new Map<string, number>();
  if (mRes.ok) {
    const m = (await mRes.json()) as MarineJson;
    m.hourly?.time.forEach((t, i) => {
      const h = m.hourly!.wave_height[i];
      if (h !== undefined) waveByTime.set(t, h);
    });
  }

  const periods: WeatherPeriod[] = [];
  for (let i = 0; i < h.time.length && periods.length < 16; i += 3) {
    const t = h.time[i];
    if (t === undefined) continue;
    const wave = waveByTime.get(t);
    const windDir = h.wind_direction_10m[i];
    const windKt = h.wind_speed_10m[i];
    const gustKt = h.wind_gusts_10m[i];
    const tempF = h.temperature_2m[i];
    const code = h.weather_code[i];
    periods.push({
      time: `${t}:00Z`,
      windDir: windDir !== undefined ? degToCompass(windDir) : undefined,
      windKt: windKt !== undefined ? Math.round(windKt) : undefined,
      gustKt: gustKt !== undefined ? Math.round(gustKt) : undefined,
      tempF: tempF !== undefined ? Math.round(tempF) : undefined,
      seasFt: wave === undefined ? undefined : Number(wave.toFixed(1)),
      sky: code !== undefined ? SKY[code] : undefined,
      precipPct: h.precipitation_probability?.[i],
    });
  }
  return periods;
}
