/**
 * Conditions — the all-access weather + tides page (public, like Welcome).
 * Pure API client over GET /api/conditions. In agent mode the readings come
 * straight from the data repo's conditions.md (Hermes maintains it on a cron);
 * in api mode the server fetches them live. The page renders identically either
 * way and degrades gracefully when a block is absent. Conditions carries NO cost
 * data, so it is identical for every role.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon.js';
import { SectionHead, Card } from '../components/atoms.js';
import { Markdown } from './Markdown.js';
import { api } from '../lib/api.js';
import { fmtTime, fmtRelative } from '../lib/format.js';
import type { Conditions, TidePrediction, TideStation } from '../lib/types.js';
import styles from './ConditionsPage.module.css';

function nextOf(preds: TidePrediction[] | undefined, type: 'H' | 'L', now: Date): TidePrediction | undefined {
  if (!preds) return undefined;
  const upcoming = preds.filter((p) => p.type === type && Date.parse(p.time) >= now.getTime());
  return (upcoming[0] ?? preds.filter((p) => p.type === type).at(-1)) || undefined;
}

function StationLine({ st, preds, now }: { st: TideStation; preds?: TidePrediction[]; now: Date }): JSX.Element {
  const hi = nextOf(preds, 'H', now);
  const lo = nextOf(preds, 'L', now);
  return (
    <div className={styles.stationRow}>
      <span>{st.name}</span>
      <span className={styles.hilo}>
        <span>▲ {hi ? fmtTime(hi.time) : '—'}</span>
        <span>▼ {lo ? fmtTime(lo.time) : '—'}</span>
      </span>
    </div>
  );
}

export default function ConditionsPage(): JSX.Element {
  const [data, setData] = useState<Conditions | null>(null);
  const now = new Date();

  useEffect(() => {
    let alive = true;
    api.conditions()
      .then((c) => { if (alive) setData(c); })
      .catch(() => { /* public + non-critical; keep the loading state on a hiccup */ });
    return () => { alive = false; };
  }, []);

  if (!data) {
    return (
      <div className="page fade-in">
        <div className="page-wrap" data-testid="conditions-loading"><p className="muted">Loading…</p></div>
      </div>
    );
  }

  if (!data.configured) {
    return (
      <div className="page fade-in">
        <div className="page-wrap" style={{ maxWidth: 720 }}>
          <SectionHead icon="waves" title="Conditions" />
          <Card pad>
            <p className="muted">Conditions aren&rsquo;t set up yet. Add a <code>conditions.md</code> to the
              data repo (location + tide stations) to show live weather and tides here.</p>
          </Card>
        </div>
      </div>
    );
  }

  const { location, weather, tides, body, asOf, stale, error } = data;
  const stations = tides?.stations ?? [];
  const primary = stations.find((s) => s.primary) ?? stations[0];
  const rest = stations.filter((s) => s !== primary);
  // Group the non-primary stations by area (preserving first-seen order).
  const byArea = new Map<string, TideStation[]>();
  for (const s of rest) {
    const key = s.area ?? 'Other';
    byArea.set(key, [...(byArea.get(key) ?? []), s]);
  }

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1080 }}>
        <div className="flex items-center gap-12" style={{ flexWrap: 'wrap', marginBottom: 6 }}>
          <SectionHead icon="waves" title="Conditions" />
        </div>
        <div className="flex items-center gap-12" style={{ flexWrap: 'wrap', marginTop: -8, marginBottom: 16 }}>
          {location && <span className="coord"><Icon name="pin" s={14} /> {location.label}</span>}
          {asOf && <span className="muted" style={{ fontSize: 13 }}>Updated {fmtRelative(asOf, now)}</span>}
          {stale && <span className={`badge ${styles.staleBadge}`}>May be out of date</span>}
        </div>

        {error === 'unavailable' && (
          <Card pad><p className="muted"><Icon name="alert" s={16} /> Live conditions are unavailable right now. Check back shortly.</p></Card>
        )}

        {/* ---------- WEATHER ---------- */}
        {weather?.periods && weather.periods.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <SectionHead icon="wind" title="Marine forecast" />
            {weather.summary && <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>{weather.summary}</p>}
            <div className={styles.strip}>
              {weather.periods.map((p) => (
                <div key={p.time} className={styles.period}>
                  <div className={styles.periodTime}>{fmtTime(p.time)}</div>
                  <div className={styles.periodWind}>
                    {p.windDir ?? ''} {p.windKt ?? '—'}<span style={{ fontSize: 13 }}> kt</span>
                  </div>
                  <div className={styles.periodMeta}>
                    {p.gustKt !== undefined && <>gust {p.gustKt} kt<br /></>}
                    {p.seasFt !== undefined && <>seas {p.seasFt} ft<br /></>}
                    {p.tempF !== undefined && <>{p.tempF}°F<br /></>}
                    {p.sky && <>{p.sky}<br /></>}
                    {p.precipPct !== undefined && <>{p.precipPct}% precip</>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---------- TIDES ---------- */}
        {stations.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <SectionHead icon="waves" title="Tides" />
            <div className={styles.board}>
              {primary && (
                <Card pad>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Nearest · {primary.area ?? 'Here'}</div>
                  <h3 style={{ fontSize: 19 }}>{primary.name}</h3>
                  <div className="flex gap-12" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                    <div><div className="muted tiny">Next high</div><div style={{ fontSize: 18 }}>▲ {fmtTime(nextOf(tides?.predictions?.[primary.id], 'H', now)?.time)}</div></div>
                    <div><div className="muted tiny">Next low</div><div style={{ fontSize: 18 }}>▼ {fmtTime(nextOf(tides?.predictions?.[primary.id], 'L', now)?.time)}</div></div>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    {(tides?.predictions?.[primary.id] ?? []).map((p) => (
                      <div key={p.time} className={styles.stationRow}>
                        <span>{p.type === 'H' ? '▲ High' : '▼ Low'}</span>
                        <span>{fmtTime(p.time)}{p.heightFt !== undefined ? ` · ${p.heightFt} ft` : ''}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {byArea.size > 0 && (
                <Card pad>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Around the harbor</div>
                  {[...byArea.entries()].map(([area, list]) => (
                    <div key={area} className={styles.areaGroup}>
                      <div className={styles.areaLabel}>{area}</div>
                      {list.map((s) => (
                        <StationLine key={s.id} st={s} preds={tides?.predictions?.[s.id]} now={now} />
                      ))}
                    </div>
                  ))}
                </Card>
              )}
            </div>
          </div>
        )}

        {/* ---------- AGENT NOTE ---------- */}
        {body && (
          <div style={{ marginTop: 28 }}>
            <Card pad><Markdown source={body} /></Card>
          </div>
        )}
      </div>
    </div>
  );
}
