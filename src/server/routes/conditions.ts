import type { Express } from 'express';
import type { AppContext } from '../app.js';
import { createConditionsService, type ConditionsService } from '../conditions/service.js';

/** Readings older than this are flagged `stale` so the UI can say "updated …". */
const STALE_THRESHOLD_MS = 6 * 60 * 60_000; // 6 h

function isStale(asOf: string | undefined, now: Date): boolean {
  if (!asOf) return true;
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > STALE_THRESHOLD_MS;
}

export function registerConditionsRoutes(app: Express, ctx: AppContext): void {
  const { store, config, now } = ctx;
  // One service for the app's lifetime so the TTL cache persists across requests.
  const service: ConditionsService = ctx.conditions ?? createConditionsService({ now });

  // Public (guest-visible), same posture as /api/welcome.
  app.get('/api/conditions', async (_req, res) => {
    const cond = store.current().conditions;
    if (!cond) {
      res.json({ configured: false, stale: true });
      return;
    }

    if (cond.source === 'agent') {
      const asOf = cond.weather?.asOf;
      res.json({
        configured: true,
        source: 'agent',
        location: cond.location,
        weather: cond.weather,
        tides: cond.tides,
        body: cond.body,
        asOf,
        stale: isStale(asOf, now()),
      });
      return;
    }

    // ---- source: 'api' ----
    const stations = cond.tides?.stations ?? [];
    if (!config.conditionsFetch) {
      res.json({
        configured: true,
        source: 'api',
        location: cond.location,
        tides: { stations },
        body: cond.body,
        stale: true,
        error: 'unavailable',
      });
      return;
    }
    try {
      const readings = await service.get({ location: cond.location, stations });
      res.json({
        configured: true,
        source: 'api',
        location: cond.location,
        weather: { source: 'Open-Meteo', asOf: readings.asOf, periods: readings.periods },
        tides: { stations, predictions: readings.predictions },
        body: cond.body,
        asOf: readings.asOf,
        stale: readings.errored || isStale(readings.asOf, now()),
        ...(readings.error ? { error: readings.error } : {}),
      });
    } catch {
      res.json({
        configured: true,
        source: 'api',
        location: cond.location,
        tides: { stations },
        body: cond.body,
        stale: true,
        error: 'unavailable',
      });
    }
  });
}
