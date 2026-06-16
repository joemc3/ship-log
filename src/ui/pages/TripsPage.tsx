/**
 * Trip logs — list + detailed log entry.
 *
 * Visually ported from the prototype's pages-logs.jsx (the .page/.card/.grid/
 * .chip/.badge/.sec-head/.photo design language), but bound to the REAL API:
 *   - data is GET /api/trips (WithBody<Trip>[]) — frontmatter + a Markdown body;
 *   - the prototype's mock fields that don't exist in the real schema
 *     (trip.summary, trip.photoCount, waypoint type "mark") are replaced by the
 *     authoritative shape: the narrative is `body` (rendered as Markdown), photos
 *     are real `photos/<name>.jpg` refs served by the /photos route, and waypoint
 *     types are depart|anchor|arrive|waypoint;
 *   - findings cross-link to their maintenance item via /maintenance?focus=<id>,
 *     matching the Shell's navTo(page,ref) convention;
 *   - every optional field degrades gracefully (the real Trip makes title,
 *     conditions, crew, waypoints, findings and photos all optional);
 *   - trips carry NO cost data, so nothing here ever touches money — the page is
 *     identical for owner/crew/guest-authed viewers.
 *
 * Routing: the list lives at /trips; a card opens the detail in place. A
 * /trips/:id deep link or a ?focus=<id> query (from a cross-link or search hit)
 * opens that trip's detail directly and scroll-highlights it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon.js';
import { Photo, Stat, SectionHead, WeatherRow, EmptyState } from '../components/atoms.js';
import { api, ApiError } from '../lib/api.js';
import { fmtDate, fmtDateShort } from '../lib/format.js';
import type { TripRec } from '../lib/types.js';
import { Markdown } from './Markdown.js';
import styles from './TripsPage.module.css';

/** Waypoint type -> timeline icon (the real schema's four types). */
const WAYPOINT_ICON: Record<NonNullable<TripRec['waypoints']>[number]['type'], IconName> = {
  depart: 'anchor',
  arrive: 'pin',
  anchor: 'anchor',
  waypoint: 'flag',
};

/** Finding severity -> badge label + tone class (matches the design's signals). */
const SEVERITY: Record<'low' | 'medium' | 'high', { label: string; cls: string }> = {
  high: { label: 'High', cls: 'overdue' },
  medium: { label: 'Medium', cls: 'due' },
  low: { label: 'Low', cls: 'scheduled' },
};

/** A trip's photo ref already carries the `photos/` prefix in the record; the
 *  /photos route serves it root-anchored. Guard against an accidental absolute. */
function photoUrl(ref: string): string {
  if (/^https?:\/\//.test(ref)) return ref;
  return `/${ref.replace(/^\/+/, '')}`;
}

/* ---------------------------------------------------------------- waypoints */

function WaypointTrack({ waypoints }: { waypoints: NonNullable<TripRec['waypoints']> }): JSX.Element {
  return (
    <div style={{ position: 'relative', paddingLeft: 8 }}>
      {waypoints.map((w, i) => (
        <div
          key={`${w.name}-${i}`}
          className="flex gap-16"
          style={{ position: 'relative', paddingBottom: i < waypoints.length - 1 ? 22 : 0 }}
        >
          {i < waypoints.length - 1 && (
            <span
              style={{
                position: 'absolute',
                left: 14,
                top: 30,
                bottom: -4,
                width: 2,
                background: 'repeating-linear-gradient(180deg, var(--brass) 0 5px, transparent 5px 10px)',
              }}
            />
          )}
          <div
            style={{
              flex: '0 0 auto',
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: 'var(--paper)',
              border: '2px solid var(--brass)',
              color: 'var(--brass-deep)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1,
            }}
          >
            <Icon name={WAYPOINT_ICON[w.type]} s={15} />
          </div>
          <div style={{ paddingTop: 2 }}>
            <div className="flex items-center gap-8" style={{ flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: 'var(--ink-800)', fontSize: 14.5 }}>{w.name}</span>
              {w.time && <span className="mono tiny" style={{ color: 'var(--brass-deep)' }}>{w.time}</span>}
            </div>
            {w.note && <p className="muted" style={{ fontSize: 13.5, marginTop: 2, marginBottom: 0 }}>{w.note}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

function TripDetail({
  trip,
  onBack,
  onOpenMaint,
}: {
  trip: TripRec;
  onBack: () => void;
  onOpenMaint: (maintId: string) => void;
}): JSX.Element {
  const findings = trip.findings ?? [];
  const crew = trip.crew ?? [];
  const waypoints = trip.waypoints ?? [];
  const photos = trip.photos ?? [];
  const hasConditions = Boolean(trip.wind || trip.seas || trip.sky || trip.tempF !== undefined);

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1000 }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 18 }}>
          <Icon name="arrowLeft" s={16} />All trips
        </button>

        <div className="flex items-center gap-12" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
          <span className="eyebrow">Trip log</span>
          <span className="coord tiny" style={{ color: 'var(--ink-tint)' }}>{trip.id}</span>
        </div>
        <h1 className="page-title">{trip.title ?? fmtDate(trip.date)}</h1>

        <div className="flex items-center gap-16" style={{ flexWrap: 'wrap', marginTop: 10 }}>
          <span className="chip"><Icon name="calendar" s={15} />{fmtDate(trip.date)}</span>
          {trip.durationHrs !== undefined && <span className="chip"><Icon name="clock" s={15} />{trip.durationHrs} hrs</span>}
          {trip.distanceNm !== undefined && <span className="chip"><Icon name="route" s={15} />{trip.distanceNm} nm</span>}
          {trip.engineHrs !== undefined && <span className="chip"><Icon name="engine" s={15} />{trip.engineHrs} engine hrs</span>}
        </div>

        <div className={`${styles.detailGrid} grid`} style={{ gridTemplateColumns: '1.3fr 1fr', marginTop: 22, alignItems: 'start' }}>
          {/* left: route + log + findings */}
          <div className="stack">
            {waypoints.length > 0 && (
              <div className="card card-pad">
                <SectionHead icon="route" title="Route" />
                <WaypointTrack waypoints={waypoints} />
              </div>
            )}

            {trip.body.trim() && (
              <div className="card card-pad">
                <SectionHead icon="log" title="Log" />
                <Markdown source={trip.body} className={styles.markdown} />
              </div>
            )}

            {findings.length > 0 && (
              <div className="card card-pad">
                <SectionHead icon="alert" title={`Findings (${findings.length})`} />
                <div className="stack">
                  {findings.map((f, i) => {
                    const sev = SEVERITY[f.severity ?? 'low'];
                    return (
                      <div
                        key={`${f.text}-${i}`}
                        className="flex gap-12"
                        style={{ alignItems: 'flex-start', padding: 12, background: 'var(--paper-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--line)' }}
                      >
                        <span className={`badge ${sev.cls}`} style={{ flex: '0 0 auto' }}>
                          <span className="dot" />{sev.label}
                        </span>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-800)' }}>{f.text}</p>
                          {f.maintId && (
                            <button
                              className="btn btn-ghost"
                              style={{ marginTop: 8, padding: '5px 11px', fontSize: 12.5 }}
                              onClick={() => onOpenMaint(f.maintId as string)}
                            >
                              <Icon name="wrench" s={14} />On the work list<Icon name="arrowRight" s={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* right: conditions, crew, photos */}
          <div className="stack">
            {hasConditions && (
              <div className="card card-pad">
                <div className="eyebrow" style={{ marginBottom: 12 }}>Conditions</div>
                <WeatherRow trip={trip} />
              </div>
            )}

            {crew.length > 0 && (
              <div className="card card-pad">
                <div className="eyebrow" style={{ marginBottom: 12 }}>Crew aboard · {crew.length}</div>
                <div className="flex wrap gap-8">
                  {crew.map((c) => (
                    <span key={c} className="chip"><Icon name="crew" s={15} />{c}</span>
                  ))}
                </div>
              </div>
            )}

            {photos.length > 0 && (
              <div className="card card-pad">
                <div className="flex items-center" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                  <span className="eyebrow">Photos · {photos.length}</span>
                  <span className="muted tiny"><Icon name="camera" s={15} /></span>
                </div>
                <div className="grid g-2" style={{ gap: 8 }}>
                  {photos.map((p) => (
                    <img
                      key={p}
                      src={photoUrl(p)}
                      alt={trip.title ?? 'Trip photo'}
                      loading="lazy"
                      style={{ width: '100%', height: 84, objectFit: 'cover', borderRadius: 'var(--r-md)', border: '1px solid var(--line)', display: 'block' }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- card */

function TripCard({ trip, onClick, highlighted }: { trip: TripRec; onClick: () => void; highlighted: boolean }): JSX.Element {
  const findings = trip.findings ?? [];
  const photos = trip.photos ?? [];
  const crew = trip.crew ?? [];
  const waypoints = trip.waypoints ?? [];
  const high = findings.filter((f) => f.severity === 'high').length;
  const cover = photos[0];

  return (
    <div
      className={`card${highlighted ? ' is-focused' : ''}`}
      style={{ overflow: 'hidden', cursor: 'pointer', outline: highlighted ? '2px solid var(--brass)' : undefined }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div style={{ position: 'relative' }}>
        {cover ? (
          <img
            src={photoUrl(cover)}
            alt={trip.title ?? 'Trip photo'}
            loading="lazy"
            style={{ width: '100%', height: 132, objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <Photo h={132} label={`${photos.length} photos`} icon="camera" />
        )}
        <div style={{ position: 'absolute', top: 12, left: 12 }}>
          <span className="badge plain" style={{ background: 'rgba(12,34,48,0.66)', color: 'var(--parchment)', borderColor: 'transparent' }}>
            {fmtDateShort(trip.date)}
          </span>
        </div>
      </div>
      <div className="card-pad" style={{ padding: 16 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, color: 'var(--ink-900)' }}>
          {trip.title ?? fmtDate(trip.date)}
        </div>
        <div className="flex wrap gap-8" style={{ marginTop: 10 }}>
          {trip.distanceNm !== undefined && <span className="chip tiny"><Icon name="route" s={14} />{trip.distanceNm} nm</span>}
          {crew.length > 0 && <span className="chip tiny"><Icon name="crew" s={14} />{crew.length}</span>}
          {trip.wind && <span className="chip tiny"><Icon name="wind" s={14} />{trip.wind.split(' ').slice(0, 2).join(' ')}</span>}
        </div>
        <div className="flex items-center" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <span className="muted tiny">{waypoints.length} waypoint{waypoints.length === 1 ? '' : 's'}</span>
          {findings.length > 0 && (
            <span className={`badge ${high ? 'overdue' : 'due'}`}>
              <span className="dot" />{findings.length} finding{findings.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export default function TripsPage(): JSX.Element {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');

  const [trips, setTrips] = useState<TripRec[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);

  // The open trip is driven by the URL: /trips/:id (deep link) or ?focus=<id>
  // (cross-link / search). Falling back to a locally-set id keeps card clicks
  // working without a full navigation, mirroring the prototype's in-place open.
  const [openId, setOpenId] = useState<string | null>(routeId ?? focusId ?? null);

  useEffect(() => {
    const next = routeId ?? focusId ?? null;
    if (next) setOpenId(next);
  }, [routeId, focusId]);

  useEffect(() => {
    let alive = true;
    api.trips()
      .then((res) => { if (alive) setTrips(res); })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : 'Could not load the trip logs.');
        setTrips([]);
      });
    return () => { alive = false; };
  }, []);

  const sorted = useMemo(
    () => (trips ? [...trips].sort((a, b) => b.date.localeCompare(a.date)) : []),
    [trips],
  );

  const open = openId ? sorted.find((t) => t.id === openId) ?? null : null;

  // Scroll the focused card into view when arriving from a cross-link to the list.
  useEffect(() => {
    if (focusId && !open && focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focusId, open, sorted]);

  if (trips === null) {
    return (
      <div className="page fade-in">
        <div className="page-wrap"><p className="muted">Loading the ship&rsquo;s log&hellip;</p></div>
      </div>
    );
  }

  if (open) {
    return (
      <TripDetail
        trip={open}
        onBack={() => { setOpenId(null); navigate('/trips'); }}
        onOpenMaint={(maintId) => navigate(`/maintenance?focus=${encodeURIComponent(maintId)}`)}
      />
    );
  }

  const totalNm = sorted.reduce((s, t) => s + (t.distanceNm ?? 0), 0);
  const totalHrs = sorted.reduce((s, t) => s + (t.durationHrs ?? 0), 0);
  const guests = new Set<string>();
  sorted.forEach((t) => (t.crew ?? []).forEach((c) => { if (c !== 'Skipper') guests.add(c); }));

  return (
    <div className="page fade-in">
      <div className="page-wrap">
        <div className="page-head">
          <span className="eyebrow">The ship&rsquo;s log</span>
          <h1 className="page-title">Trip logs</h1>
          <p className="page-lead">
            Every outing aboard &mdash; where we went, who was aboard, the conditions, and anything
            we noticed that needs attention.
          </p>
        </div>

        {error && (
          <div className="card card-pad" role="alert" style={{ marginBottom: 22, borderColor: 'var(--sig-overdue)' }}>
            <span className="muted">{error}</span>
          </div>
        )}

        <div className="grid g-4" style={{ marginBottom: 22 }}>
          <div className="card card-pad"><Stat label="Trips logged" value={sorted.length} sm /></div>
          <div className="card card-pad"><Stat label="Distance" value={`${totalNm.toFixed(1)} nm`} sm /></div>
          <div className="card card-pad"><Stat label="Hours afloat" value={`${totalHrs.toFixed(1)}`} sm /></div>
          <div className="card card-pad"><Stat label="Guests aboard" value={guests.size} sm /></div>
        </div>

        <SectionHead icon="log" title="All trips" />

        {sorted.length === 0 ? (
          <EmptyState icon="log" title="No trips logged yet" hint="The first outing will appear here once it's recorded." />
        ) : (
          <div className="grid g-3">
            {sorted.map((t) => (
              <div key={t.id} ref={t.id === focusId ? focusRef : undefined}>
                <TripCard
                  trip={t}
                  highlighted={t.id === focusId}
                  onClick={() => { setOpenId(t.id); navigate(`/trips/${encodeURIComponent(t.id)}`); }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
