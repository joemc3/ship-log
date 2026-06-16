/**
 * Search — the dedicated full-page search (route /search), recreating the VISUAL
 * design of the prototype's pages-search.jsx (the rounded free-text bar, the
 * grouped result cards with `.find-row` rows, the page-head copy) but bound to
 * the REAL API:
 *
 *   - results come from GET /api/search?q= as a flat SearchHit[]{collection,id,
 *     title}; we group them by collection and render one `.find-row` per hit.
 *     The prototype's elaborate "look it up by crew / place / purchase / vendor"
 *     facets read the mock window.DATA (per-trip crew arrays, costs, etc.) that
 *     the real flat search contract does NOT expose, so they are intentionally
 *     dropped — the real page is free text -> grouped hits -> deep link.
 *   - every hit deep-links to its OWNING page + record via the SPA's `?focus=`
 *     convention (e.g. a trip -> /trips?focus=<id>), matching the Shell overlay's
 *     navigation, so a result opens exactly the record it names.
 *   - CRITICAL role posture: the server searches the REDACTED view, so a
 *     crew/guest viewer never receives a cost hit. We simply render whatever the
 *     API returns; there is NO "Costs" filter/facet that would imply costs exist
 *     for crew, and the page surfaces no money of its own.
 *
 * The page is read-only (no forms). The query is seeded from a `?q=` URL param
 * (so the Shell's cmd-K "open search here" and shared deep links work), and the
 * input autofocuses on mount so landing here is type-ready.
 *
 * Reuses the shared app.css classes (.page/.card/.find-row/.eyebrow/.chip/
 * .sec-head/.page-*); one small co-located module sheet holds the rounded search
 * bar that has no global class.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon.js';
import { api, ApiError } from '../lib/api.js';
import type { SearchHit } from '../lib/types.js';
import styles from './SearchPage.module.css';

/** Search-hit collection -> its owning page route, list icon, and group label.
 *  Mirrors the Shell's HIT_ROUTE so the dedicated page and the cmd-K overlay
 *  navigate identically. A `cost` hit only ever reaches an owner (the server
 *  redacts it for crew/guest), so no special-casing is needed here. */
const HIT_ROUTE: Record<SearchHit['collection'], { path: string; icon: IconName; cat: string }> = {
  trip: { path: '/trips', icon: 'log', cat: 'Trip logs' },
  maintenance: { path: '/maintenance', icon: 'wrench', cat: 'Maintenance' },
  cost: { path: '/costs', icon: 'coins', cat: 'Costs' },
  vendor: { path: '/vendors', icon: 'store', cat: 'Vendors' },
  inventory: { path: '/inventory', icon: 'box', cat: 'Inventory' },
  manual: { path: '/manuals', icon: 'book', cat: 'Manuals' },
};

/** Stable group ordering so results read the same regardless of hit order. */
const GROUP_ORDER: SearchHit['collection'][] = [
  'trip',
  'maintenance',
  'inventory',
  'manual',
  'vendor',
  'cost',
];

/** A single result row — a `.find-row` button that opens the owning record. */
function HitRow({ hit, onGo }: { hit: SearchHit; onGo: (hit: SearchHit) => void }): JSX.Element {
  const meta = HIT_ROUTE[hit.collection];
  return (
    <button className="find-row" onClick={() => onGo(hit)}>
      <span style={{ color: 'var(--brass-deep)', flex: '0 0 auto' }}>
        <Icon name={meta.icon} s={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--ink-800)' }}>{hit.title}</div>
        <div className="muted tiny" style={{ marginTop: 2 }}>{meta.cat}</div>
      </div>
      <span style={{ color: 'var(--ink-tint)', flex: '0 0 auto' }}>
        <Icon name="arrowRight" s={16} />
      </span>
    </button>
  );
}

export default function SearchPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const seeded = searchParams.get('q') ?? '';

  const [q, setQ] = useState(seeded);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus on mount so a cmd-K / "/" landing here is type-ready.
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced query so each keystroke doesn't hammer the API; the empty query is
  // never sent (an empty server search returns nothing anyway).
  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits([]); setSearched(false); setError(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.search(term)
        .then((res) => { if (alive) { setHits(res); setSearched(true); setError(null); } })
        .catch((err: unknown) => {
          if (!alive) return;
          setHits([]);
          setSearched(true);
          setError(err instanceof ApiError ? err.message : 'Search is unavailable right now.');
        });
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  // Keep the URL `?q=` in sync with the box, so the search is shareable/bookmarkable
  // and a back/forward navigation restores the query (replace: no history spam).
  useEffect(() => {
    const term = q.trim();
    const current = searchParams.get('q') ?? '';
    if (term === current) return;
    const next = new URLSearchParams(searchParams);
    if (term) next.set('q', term); else next.delete('q');
    setSearchParams(next, { replace: true });
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const onGo = (hit: SearchHit): void => {
    navigate(`${HIT_ROUTE[hit.collection].path}?focus=${encodeURIComponent(hit.id)}`);
  };

  // Group the flat hits by collection, in a stable order. The server already
  // redacted the view, so a crew/guest set simply has no `cost` group — we never
  // synthesize one.
  const groups = useMemo(() => {
    const by = new Map<SearchHit['collection'], SearchHit[]>();
    for (const h of hits) {
      const arr = by.get(h.collection) ?? [];
      arr.push(h);
      by.set(h.collection, arr);
    }
    return GROUP_ORDER
      .filter((c) => by.has(c))
      .map((c) => ({ collection: c, label: HIT_ROUTE[c].cat, items: by.get(c)! }));
  }, [hits]);

  const term = q.trim();

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1000 }}>
        <div className="page-head">
          <span className="eyebrow">Find anything aboard</span>
          <h1 className="page-title">Search</h1>
          <p className="page-lead">
            Search every log, repair, manual and vendor in one place &mdash; type a few words and
            jump straight to what you need.
          </p>
        </div>

        {/* free-text bar */}
        <div className="card card-pad" style={{ padding: 18 }}>
          <div className={styles.searchBar}>
            <span style={{ color: 'var(--brass-deep)', flex: '0 0 auto' }}><Icon name="search" s={20} /></span>
            <input
              ref={inputRef}
              type="search"
              aria-label="Search the whole boat"
              className={styles.searchInput}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search trips, repairs, manuals, vendors&hellip;"
            />
            {q && (
              <button
                type="button"
                aria-label="Clear search"
                className={styles.clearBtn}
                onClick={() => { setQ(''); inputRef.current?.focus(); }}
              >
                <Icon name="close" s={18} />
              </button>
            )}
          </div>

          {error && (
            <div className="muted" role="alert" style={{ marginTop: 14, color: 'var(--sig-overdue)' }}>
              {error}
            </div>
          )}

          {!term && !error && (
            <div className="muted tiny" style={{ marginTop: 12 }}>
              Try a boat system, a place, a part, or a vendor name.
            </div>
          )}

          {term && !error && searched && hits.length === 0 && (
            <div className="muted" style={{ padding: '18px 4px' }}>
              Nothing aboard matches &ldquo;{term}&rdquo;.
            </div>
          )}

          {hits.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {groups.map((g) => (
                <div key={g.collection} style={{ marginTop: 10 }}>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>
                    {g.label} &middot; {g.items.length}
                  </div>
                  <div className="card" style={{ overflow: 'hidden' }}>
                    {g.items.map((h) => (
                      <HitRow key={h.collection + h.id} hit={h} onGo={onGo} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
