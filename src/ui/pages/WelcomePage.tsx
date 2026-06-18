/**
 * Welcome / About — the shareable PUBLIC page (the only page a guest may see).
 *
 * Visually ported from the prototype's pages-welcome.jsx (the hero with its
 * compass watermark + depth contours, the quick-stat strip, the house-rules
 * grid, "what to expect", the bring/safety split, and the closing card) — but
 * bound to the REAL API. GET /api/welcome serves ONLY the curated identity +
 * welcome block ({ name, make?, model?, year?, hailingPort?, welcome:{ rules?,
 * whatToExpect?, whatToBring?, safety? } }); the server does NOT spread
 * boat.yaml's specs/tagline/coords here, so the prototype's SpecTable / lat-lon
 * / blurb have no real source and are intentionally omitted. Every section
 * degrades gracefully: a missing curated field renders nothing rather than a
 * placeholder, so a sparse boat still produces a clean page.
 *
 * The page carries its own Share hook (the prototype's `onShare`) as a local
 * ShareModal — the Shell owns a sidebar Share button too; this is the in-page
 * hero affordance. The Login affordance shows only for an anonymous guest in a
 * non-demo deployment (demo disables sign-in).
 *
 * Zero hardcoded boat strings: every boat-specific value comes from the fetch.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, CompassRose } from '../components/Icon.js';
import { SectionHead, Stat, Photo } from '../components/atoms.js';
import { useSession } from '../state/session.js';
import { api } from '../lib/api.js';
import type { Welcome } from '../lib/types.js';

/** `1985 Catalina 25` from whatever curated identity fields are present. */
function makeModelYear(w: Welcome): string {
  return [w.year, w.make, w.model].filter((p) => p !== undefined && p !== '').join(' ');
}

export default function WelcomePage(): JSX.Element {
  const { isAuthed, demo } = useSession();
  const [welcome, setWelcome] = useState<Welcome | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .welcome()
      .then((w) => {
        if (alive) setWelcome(w);
      })
      .catch(() => {
        /* /api/welcome is guest-safe and should not fail; on a hiccup we simply
           keep the loading state rather than fabricate boat strings. */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!welcome) {
    return (
      <div className="page fade-in">
        <div className="page-wrap" data-testid="welcome-loading">
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  const w = welcome;
  const block = w.welcome ?? {};
  const mmy = makeModelYear(w);
  // Only show the Login affordance to an anonymous guest in a real deployment;
  // demo disables sign-in, and an authed viewer has no use for it.
  const showLogin = !isAuthed && !demo;

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1080 }}>
        {/* ---------- HERO ---------- */}
        <div
          style={{
            position: 'relative',
            borderRadius: 'var(--r-xl)',
            overflow: 'hidden',
            background: 'linear-gradient(155deg, var(--ink-700), var(--ink-900))',
            color: 'var(--parchment)',
            boxShadow: 'var(--shadow-md)',
            border: '1px solid rgba(0,0,0,0.3)',
          }}
        >
          {/* compass watermark */}
          <div
            style={{ position: 'absolute', right: -60, top: -40, color: 'var(--brass-bright)', opacity: 0.12, pointerEvents: 'none' }}
            aria-hidden="true"
          >
            <CompassRose s={360} sw={1} />
          </div>
          {/* depth contour lines */}
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.1 }}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M-20 80 Q 300 40 700 110 T 1400 90" fill="none" stroke="#C99B4E" strokeWidth="1.2" />
            <path d="M-20 150 Q 350 110 720 180 T 1400 160" fill="none" stroke="#C99B4E" strokeWidth="1.2" />
            <path d="M-20 230 Q 300 190 700 260 T 1400 240" fill="none" stroke="#C99B4E" strokeWidth="1.2" />
          </svg>

          <div
            className="hero-grid"
            style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 24, padding: '40px 40px 36px' }}
          >
            <div>
              <div className="eyebrow on-ink">Welcome aboard · You&rsquo;re invited to sail</div>
              <h1 style={{ color: '#fff', fontSize: 'clamp(48px, 8vw, 76px)', lineHeight: 0.95, marginTop: 14, letterSpacing: '0.01em' }}>
                {w.name}
              </h1>
              <div className="flex items-center gap-12" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                {mmy && (
                  <span
                    className="badge plain"
                    style={{ background: 'rgba(242,232,213,0.12)', color: 'var(--parchment)', borderColor: 'rgba(242,232,213,0.2)' }}
                  >
                    {mmy}
                  </span>
                )}
                {w.hailingPort && (
                  <span className="coord" style={{ fontSize: 13, color: 'var(--brass-bright)' }}>
                    <Icon name="pin" s={14} /> {w.hailingPort}
                  </span>
                )}
              </div>
              <p
                style={{
                  color: 'rgba(242,232,213,0.92)',
                  fontSize: 18,
                  maxWidth: '46ch',
                  marginTop: 18,
                  fontFamily: 'var(--font-display)',
                  fontStyle: 'italic',
                }}
              >
                A relaxed day of wind and water — we&rsquo;d love to have you aboard.
              </p>
              <div className="flex gap-12" style={{ marginTop: 22, flexWrap: 'wrap' }}>
                <button className="btn btn-brass" onClick={() => setShareOpen(true)}>
                  <Icon name="share" s={16} />
                  Share this page
                </button>
                {showLogin && (
                  <Link
                    className="btn btn-ghost"
                    to="/login"
                    style={{ color: 'var(--parchment)', borderColor: 'rgba(242,232,213,0.25)' }}
                  >
                    <Icon name="helm" s={16} />
                    Log in
                  </Link>
                )}
                {w.hailingPort && (
                  <span className="btn btn-ghost" style={{ color: 'var(--parchment)', borderColor: 'rgba(242,232,213,0.25)' }}>
                    <Icon name="pin" s={16} />
                    {w.hailingPort}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'stretch' }}>
              {w.heroPhoto ? (
                <img
                  src="/api/welcome/hero"
                  alt={`${w.name} under sail`}
                  style={{
                    width: '100%',
                    height: 260,
                    objectFit: 'cover',
                    borderRadius: 'var(--r-md)',
                    border: '1px solid rgba(242,232,213,0.2)',
                  }}
                />
              ) : (
                <Photo
                  label={`${w.name} under sail`}
                  h={260}
                  icon="sail"
                  style={{ width: '100%', border: '1px solid rgba(242,232,213,0.2)' }}
                />
              )}
            </div>
          </div>
        </div>

        {/* ---------- QUICK STATS STRIP ---------- */}
        {(mmy || w.hailingPort) && (
          <div className="grid g-4" style={{ marginTop: 18 }}>
            {w.year !== undefined && (
              <div className="card card-pad" style={{ textAlign: 'left' }}>
                <Stat label="Launched" value={w.year} sm />
              </div>
            )}
            {w.make && (
              <div className="card card-pad" style={{ textAlign: 'left' }}>
                <Stat label="Make" value={w.make} sm />
              </div>
            )}
            {w.model && (
              <div className="card card-pad" style={{ textAlign: 'left' }}>
                <Stat label="Model" value={w.model} sm />
              </div>
            )}
            {w.hailingPort && (
              <div className="card card-pad" style={{ textAlign: 'left' }}>
                <Stat label="Hailing port" value={w.hailingPort} sm />
              </div>
            )}
          </div>
        )}

        {/* ---------- HOUSE RULES ---------- */}
        {block.rules && block.rules.length > 0 && (
          <div style={{ marginTop: 36 }}>
            <SectionHead icon="flag" title="A few things before you step aboard" />
            <p className="muted" style={{ marginTop: -8, marginBottom: 16, maxWidth: '70ch' }}>
              None of this is meant to be fussy — it&rsquo;s just how we keep everyone safe and comfortable. If
              you&rsquo;ve never sailed before, don&rsquo;t worry about a thing: we&rsquo;ll walk you through it all.
            </p>
            <div className="grid g-2">
              {block.rules.map((rule) => (
                <div key={rule} className="card card-pad" style={{ display: 'flex', gap: 16 }}>
                  <div
                    style={{
                      flex: '0 0 auto',
                      width: 46,
                      height: 46,
                      borderRadius: 12,
                      background: 'var(--ink-700)',
                      color: 'var(--brass-bright)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="life" s={24} />
                  </div>
                  <p style={{ fontSize: 15.5, color: 'var(--ink-800)', alignSelf: 'center' }}>{rule}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---------- WHAT TO EXPECT ---------- */}
        {block.whatToExpect && (
          <div style={{ marginTop: 36 }}>
            <SectionHead icon="helm" title="What to expect on the water" />
            <div className="card card-pad" style={{ background: 'var(--paper-2)' }}>
              <p style={{ fontSize: 16.5, color: 'var(--ink-700)' }}>{block.whatToExpect}</p>
            </div>
          </div>
        )}

        {/* ---------- LEAVE ASHORE ---------- */}
        {block.keepOff && block.keepOff.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <SectionHead icon="close" title="Leave ashore" />
            <div
              className="card card-pad"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px 16px',
                background: 'var(--paper-2)',
                border: '1px solid var(--line)',
              }}
            >
              {block.keepOff.map((item, i) => (
                <span
                  key={item}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    borderRadius: 20,
                    background: 'var(--ink-50)',
                    color: 'var(--ink-700)',
                    fontSize: 14.5,
                    fontWeight: 500,
                    border: '1px solid rgba(0,0,0,0.06)',
                  }}
                >
                  <span style={{ color: 'var(--rust)' }}>✕</span>
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ---------- BRING + SAFETY ---------- */}
        {(((block.whatToBring?.length ?? 0) > 0) || block.safety) && (
          <div className="grid welcome-split" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 32 }}>
            {block.whatToBring && block.whatToBring.length > 0 && (
              <div className="card card-pad">
                <div className="eyebrow" style={{ marginBottom: 12 }}>
                  Pack a soft bag with
                </div>
                <div className="stack">
                  {block.whatToBring.map((item) => (
                    <div key={item} className="flex items-center gap-12">
                      <span style={{ color: 'var(--patina)' }}>
                        <Icon name="check" s={18} />
                      </span>
                      <span style={{ fontSize: 14.5, color: 'var(--ink-700)' }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {block.safety && (
              <div
                className="card card-pad"
                style={{ background: 'var(--ink-800)', color: 'var(--parchment)', border: '1px solid rgba(0,0,0,0.3)' }}
              >
                <div className="eyebrow on-ink" style={{ marginBottom: 12 }}>
                  Safety always wins
                </div>
                <div className="flex gap-12" style={{ alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--brass-bright)', flex: '0 0 auto' }}>
                    <Icon name="life" s={20} />
                  </span>
                  <p style={{ fontSize: 14.5, color: 'rgba(242,232,213,0.92)' }}>{block.safety}</p>
                </div>
                <p
                  style={{
                    fontSize: 13.5,
                    color: 'rgba(242,232,213,0.7)',
                    marginTop: 16,
                    fontStyle: 'italic',
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  Feeling queasy is normal and nothing to be shy about — tell us early and we&rsquo;ll sort it out fast.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ---------- CLOSING ---------- */}
        <div className="card card-pad" style={{ marginTop: 36, textAlign: 'center', padding: '34px 24px', background: 'var(--paper-2)' }}>
          <div style={{ display: 'inline-flex', color: 'var(--brass)' }}>
            <CompassRose s={42} />
          </div>
          <h3 style={{ fontSize: 24, marginTop: 12 }}>We can&rsquo;t wait to have you aboard</h3>
          <p className="muted" style={{ maxWidth: '52ch', margin: '8px auto 0' }}>
            Questions before the big day? Just ask. Otherwise, wear soft soles, bring a layer, and come ready
            for a relaxed day of wind and water.
          </p>
          <div className="coord" style={{ marginTop: 16, fontSize: 12.5, color: 'var(--brass-deep)' }}>
            FAIR WINDS · {w.name.toUpperCase()}
          </div>
        </div>
      </div>

      {shareOpen && <ShareModal boatName={w.name} onClose={() => setShareOpen(false)} />}

      <style>{`
        @media (max-width: 760px){ .hero-grid{ grid-template-columns:1fr !important; } .hero-grid .photo{ height:180px !important; } }
        @media (max-width: 720px){ .welcome-split{ grid-template-columns:1fr !important; } }
      `}</style>
    </div>
  );
}

/* ---------- Share modal (the in-page Share hook) ----------
   Visually mirrors the Shell's ShareModal; co-located here so the page owns its
   own hero "Share this page" affordance without reaching into the Shell. The
   link is always the public welcome root, the only URL safe to share. */
function ShareModal({ boatName, onClose }: { boatName: string; onClose: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== 'undefined' ? `${window.location.origin}/` : '/';
  const copy = (): void => {
    try {
      void navigator.clipboard?.writeText(link);
    } catch {
      /* clipboard may be unavailable (e.g. insecure context) — the link is still shown to copy by hand. */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="overlay" onMouseDown={onClose} style={{ alignItems: 'center', paddingTop: 0 }}>
      <div
        className="card fade-in"
        style={{ width: 'min(440px,92vw)', padding: 24 }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${boatName}'s welcome page`}
      >
        <div className="flex items-center gap-12" style={{ marginBottom: 6 }}>
          <span style={{ color: 'var(--brass-deep)' }}>
            <Icon name="share" s={22} />
          </span>
          <h3 style={{ fontSize: 21 }}>Share {boatName}&rsquo;s welcome page</h3>
          <button
            className="btn btn-ghost"
            aria-label="Close"
            onClick={onClose}
            style={{ marginLeft: 'auto', padding: '4px 8px' }}
          >
            <Icon name="close" s={16} />
          </button>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          Send this link to anyone you&rsquo;ve invited aboard. It shows the boat, the house rules, what to
          bring, and what to expect &mdash; perfect for first-timers.
        </p>
        <div className="flex items-center gap-8" style={{ marginTop: 14 }}>
          <div
            className="mono"
            style={{
              flex: 1,
              padding: '11px 14px',
              background: 'var(--paper-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              fontSize: 13,
              color: 'var(--ink-700)',
            }}
          >
            {link}
          </div>
          <button className="btn btn-brass" onClick={copy}>
            <Icon name={copied ? 'check' : 'share'} s={16} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
