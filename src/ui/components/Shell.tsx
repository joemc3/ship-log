/**
 * App shell — sidebar nav, topbar (crumbs + cmd-K search pill), mobile drawer,
 * the cmd-K/"/" search overlay, the Share modal, and a persistent DEMO banner.
 * Ported VISUALLY from the prototype's app.jsx (.shell/.sidebar/.topbar classes,
 * NAV groups, brand CompassRose) but rewired to the real app:
 *   - the boat NAME comes from GET /api/welcome (falls back to /api/boat), never
 *     a hardcoded "Valkyrie";
 *   - the maintenance nav-badge is GET /api/derived.attention (server-computed),
 *     not the prototype's hardcoded-2024 daysUntil count;
 *   - nav + auth affordances are ROLE-AWARE: Costs/Admin are owner-only, Login
 *     shows for an anonymous guest, user+logout+change-password for an authed
 *     viewer, and demo hides Login;
 *   - the search overlay queries GET /api/search and routes to the hit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon, CompassRose, type IconName } from './Icon.js';
import { useSession } from '../state/session.js';
import { api } from '../lib/api.js';
import type { SearchHit } from '../lib/types.js';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Visibility predicate against the session role flags. */
  show?: (s: { isOwner: boolean; isAuthed: boolean; assistantEnabled: boolean }) => boolean;
  badge?: boolean;
}
interface NavGroup {
  group: string;
  items: NavItem[];
}

// Mirrors the prototype NAV groups; `show` adds the role gates the prototype
// didn't need (it had no roles). Welcome is always visible; the rest require auth.
const NAV: NavGroup[] = [
  { group: 'Aboard', items: [{ to: '/', label: 'Welcome', icon: 'helm' }] },
  { group: 'Find', items: [{ to: '/search', label: 'Search', icon: 'search', show: (s) => s.isAuthed }] },
  {
    group: 'Operations',
    items: [
      { to: '/trips', label: 'Trip logs', icon: 'log', show: (s) => s.isAuthed },
      { to: '/maintenance', label: 'Maintenance', icon: 'wrench', show: (s) => s.isAuthed, badge: true },
      { to: '/inventory', label: 'Inventory', icon: 'box', show: (s) => s.isAuthed },
      { to: '/assistant', label: 'Ask the Purser', icon: 'crew', show: (s) => s.isAuthed && s.assistantEnabled },
      { to: '/costs', label: 'Costs', icon: 'coins', show: (s) => s.isOwner },
    ],
  },
  {
    group: 'Reference',
    items: [
      { to: '/manuals', label: 'Manuals', icon: 'book', show: (s) => s.isAuthed },
      { to: '/vendors', label: 'Vendors', icon: 'store', show: (s) => s.isAuthed },
    ],
  },
  { group: 'Admin', items: [{ to: '/admin', label: 'Admin', icon: 'crew', show: (s) => s.isOwner }] },
];

/** Page title for the topbar crumb, keyed by the first path segment. */
const CRUMBS: Record<string, string> = {
  '': 'Welcome',
  trips: 'Trip logs',
  maintenance: 'Maintenance',
  inventory: 'Inventory',
  costs: 'Costs',
  manuals: 'Manuals',
  vendors: 'Vendors',
  search: 'Search',
  admin: 'Admin',
  account: 'Account',
  login: 'Sign in',
  assistant: 'Purser',
};

/** Search-hit collection -> its page route + list icon. */
const HIT_ROUTE: Record<SearchHit['collection'], { path: string; icon: IconName; cat: string }> = {
  trip: { path: '/trips', icon: 'log', cat: 'Trip logs' },
  maintenance: { path: '/maintenance', icon: 'wrench', cat: 'Maintenance' },
  cost: { path: '/costs', icon: 'coins', cat: 'Costs' },
  vendor: { path: '/vendors', icon: 'store', cat: 'Vendors' },
  inventory: { path: '/inventory', icon: 'box', cat: 'Inventory' },
  manual: { path: '/manuals', icon: 'book', cat: 'Manuals' },
};

export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const session = useSession();
  const { isOwner, isAuthed, demo, username, logout, assistantEnabled, assistantLabel } = session;
  const location = useLocation();
  const navigate = useNavigate();

  const [boatName, setBoatName] = useState('Ship’s Log');
  const [attention, setAttention] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Brand name: welcome is guest-safe and always reachable; fall back to /boat
  // for an authed viewer if welcome somehow lacks a name.
  useEffect(() => {
    let alive = true;
    api.welcome()
      .then((w) => { if (alive && w?.name) setBoatName(w.name); })
      .catch(() => { /* keep the default brand */ });
    return () => { alive = false; };
  }, []);

  // Maintenance nav-badge: server-computed attention count (auth only).
  useEffect(() => {
    if (!isAuthed) { setAttention(0); return; }
    let alive = true;
    api.derived()
      .then((d) => { if (alive) setAttention(d.attention); })
      .catch(() => { if (alive) setAttention(0); });
    return () => { alive = false; };
  }, [isAuthed, location.pathname]);

  const openSearch = useCallback(() => { if (isAuthed) { setSearchOpen(true); setNavOpen(false); } }, [isAuthed]);

  // cmd-K / "/" opens search (mirrors the prototype global key handler).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') { e.preventDefault(); openSearch(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch]);

  // Close the mobile drawer on navigation.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  const flags = { isOwner, isAuthed, assistantEnabled: assistantEnabled ?? false };
  const groups = useMemo(
    () => NAV
      .map((g) => ({ ...g, items: g.items.filter((it) => (it.show ? it.show(flags) : true)) }))
      .filter((g) => g.items.length > 0),
    [isOwner, isAuthed, assistantEnabled],
  );

  const seg = location.pathname.split('/')[1] ?? '';
  const crumb = CRUMBS[seg] ?? 'Ship’s Log';
  const isActive = (to: string): boolean =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <div className="shell">
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-row">
            <span className="brand-compass"><CompassRose s={40} /></span>
            <div>
              <div className="brand-name">{boatName}</div>
              <div className="brand-sub">Ship&rsquo;s Log</div>
            </div>
          </div>
        </div>

        <nav className="nav" aria-label="Primary">
          {groups.map((grp) => (
            <div key={grp.group}>
              <div className="nav-group-label">{grp.group}</div>
              {grp.items.map((it) => (
                <Link
                  key={it.to}
                  to={it.to}
                  className={`nav-item${isActive(it.to) ? ' active' : ''}`}
                >
                  <span className="nav-ico"><Icon name={it.icon} s={19} /></span>
                  {it.to === '/assistant' ? (assistantLabel ?? 'Ask the Purser') : it.label}
                  {it.badge && attention > 0 && <span className="nav-badge">{attention}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button className="share-btn" onClick={() => setShareOpen(true)}>
            <Icon name="share" s={16} />Share welcome page
          </button>
          <SidebarAuth
            isAuthed={isAuthed}
            demo={demo}
            username={username}
            onLogout={() => void logout()}
          />
        </div>
      </aside>

      <div className="main">
        {demo && (
          <div className="demo-banner" role="status">
            <Icon name="info" s={16} />
            <span>Demo mode — everything is read-only and sign-in is disabled.</span>
          </div>
        )}
        <header className="topbar">
          <button className="menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <Icon name="menu" s={20} />
          </button>
          <div className="crumbs">{boatName} <span style={{ opacity: 0.4 }}>/</span> <b>{crumb}</b></div>
          {isAuthed && (
            <button className="search-pill" aria-label="Search the whole boat" onClick={openSearch}>
              <Icon name="search" s={17} />
              <span className="sp-label">Search the whole boat&hellip;</span>
              <kbd>&#8984;K</kbd>
            </button>
          )}
        </header>
        <main>{children}</main>
      </div>

      {shareOpen && <ShareModal boatName={boatName} onClose={() => setShareOpen(false)} />}
      {searchOpen && (
        <SearchOverlay
          onClose={() => setSearchOpen(false)}
          onGo={(hit) => {
            setSearchOpen(false);
            navigate(`${HIT_ROUTE[hit.collection].path}?focus=${encodeURIComponent(hit.id)}`);
          }}
        />
      )}
    </div>
  );
}

/** Sidebar auth block: Login link for a guest, user identity + change-password +
 *  logout for an authed viewer. Demo shows neither (read-only, no accounts). */
function SidebarAuth({
  isAuthed,
  demo,
  username,
  onLogout,
}: {
  isAuthed: boolean;
  demo: boolean;
  username: string | null;
  onLogout: () => void;
}): JSX.Element | null {
  if (demo) return null;
  if (!isAuthed) {
    return (
      <Link className="share-btn" to="/login" style={{ marginTop: 8 }}>
        <Icon name="helm" s={16} />Log in
      </Link>
    );
  }
  return (
    <div className="sidebar-user" style={{ marginTop: 10 }}>
      <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
        <Icon name="crew" s={16} />
        <span className="user-name">{username ?? 'Signed in'}</span>
      </div>
      <div className="flex gap-8">
        <Link className="btn btn-ghost" to="/account">Change password</Link>
        <button className="btn btn-ghost" onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}

/* ---------- Search overlay — queries GET /api/search ---------- */
function SearchOverlay({ onClose, onGo }: { onClose: () => void; onGo: (hit: SearchHit) => void }): JSX.Element {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced query so each keystroke doesn't hammer the API.
  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.search(term)
        .then((res) => { if (alive) { setHits(res); setCursor(0); } })
        .catch(() => { if (alive) setHits([]); });
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const grouped = useMemo(() => {
    const g = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const cat = HIT_ROUTE[h.collection].cat;
      const arr = g.get(cat) ?? [];
      arr.push(h);
      g.set(cat, arr);
    }
    return [...g.entries()];
  }, [hits]);

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && hits[cursor]) onGo(hits[cursor]);
  };

  let flat = -1;
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="search-modal fade-in" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="search-input-row">
          <span style={{ color: 'var(--brass-deep)' }}><Icon name="search" s={22} /></span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search trips, repairs, costs, manuals, vendors&hellip;"
          />
          <span className="muted tiny mono">ESC</span>
        </div>
        <div className="search-results">
          {q.trim() && hits.length === 0 && (
            <div style={{ padding: '26px 20px', textAlign: 'center' }} className="muted">
              Nothing aboard matches &ldquo;{q}&rdquo;.
            </div>
          )}
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <div className="search-cat">{cat}</div>
              {items.map((it) => {
                flat += 1;
                const my = flat;
                return (
                  <div
                    key={it.collection + it.id}
                    className={`search-hit${my === cursor ? ' cursor' : ''}`}
                    onMouseEnter={() => setCursor(my)}
                    onClick={() => onGo(it)}
                  >
                    <span className="hit-ico"><Icon name={HIT_ROUTE[it.collection].icon} s={18} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div className="hit-title">{it.title}</div>
                      <div className="hit-sub">{HIT_ROUTE[it.collection].cat}</div>
                    </div>
                    <span className="muted" style={{ marginLeft: 'auto' }}><Icon name="arrowRight" s={16} /></span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="search-foot">
          <span>&#8593;&#8595; to navigate</span><span>&#8629; to open</span><span>esc to close</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Share modal (welcome link) ---------- */
function ShareModal({ boatName, onClose }: { boatName: string; onClose: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== 'undefined' ? `${window.location.origin}/` : '/';
  const copy = (): void => {
    try { void navigator.clipboard?.writeText(link); } catch { /* clipboard may be unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="overlay" onMouseDown={onClose} style={{ alignItems: 'center', paddingTop: 0 }}>
      <div className="card fade-in" style={{ width: 'min(440px,92vw)', padding: 24 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-12" style={{ marginBottom: 6 }}>
          <span style={{ color: 'var(--brass-deep)' }}><Icon name="share" s={22} /></span>
          <h3 style={{ fontSize: 21 }}>Share {boatName}&rsquo;s welcome page</h3>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          Send this link to anyone you&rsquo;ve invited aboard. It shows the boat, the house rules,
          what to bring, and what to expect &mdash; perfect for first-timers.
        </p>
        <div className="flex items-center gap-8" style={{ marginTop: 14 }}>
          <div
            className="mono"
            style={{ flex: 1, padding: '11px 14px', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 13, color: 'var(--ink-700)' }}
          >
            {link}
          </div>
          <button className="btn btn-brass" onClick={copy}>
            <Icon name={copied ? 'check' : 'share'} s={16} />{copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
