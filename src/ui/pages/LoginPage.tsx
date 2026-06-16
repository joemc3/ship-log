/**
 * Login — the sign-in screen for an anonymous guest in a real deployment. The
 * AppRouter's LoginRoute already gates this (an authed viewer, or any demo
 * viewer, is redirected home), but the page is defensive: in demo mode it shows
 * a read-only notice and disables the form, since /api/login is a server 400
 * there.
 *
 * It POSTs /api/login via `session.login(username, password)` (which on success
 * refreshes GET /api/me so the whole tree re-renders against the authoritative
 * role), then redirects into the app — to the path the guest first attempted
 * (carried in the router `state.from` by RequireAuth), defaulting to Welcome.
 *
 * AUTH UX: error messaging is deliberately GENERIC. A wrong username and a wrong
 * password both surface the same "check them and try again" line — we mirror the
 * server's flat 401 ("invalid credentials") and never reveal whether the account
 * exists (no user-enumeration). A 429 rate-limit is surfaced distinctly as a
 * "wait a moment" notice so the user knows to pause rather than re-type.
 */
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon, CompassRose } from '../components/Icon.js';
import { useSession } from '../state/session.js';
import { ApiError } from '../lib/api.js';

interface LocationState {
  from?: string;
}

export default function LoginPage(): JSX.Element {
  const { login, demo } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from ?? '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || demo) return;
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      // On success the session refresh flips isAuthed; leave /login for the app,
      // returning to the originally-attempted path when there was one.
      navigate(from, { replace: true });
    } catch (err: unknown) {
      // GENERIC by design: never disclose whether the username or the password
      // was the problem. The 429 is the one distinct case (rate-limited).
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        setError('That username and password didn’t match. Check them and try again.');
      }
      setBusy(false);
    }
  };

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 460 }}>
        <div className="card card-pad" style={{ marginTop: 24 }}>
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{ display: 'inline-flex', color: 'var(--brass)' }}>
              <CompassRose s={44} />
            </div>
            <span className="eyebrow" style={{ display: 'block', marginTop: 10 }}>Ship’s log</span>
            <h1 className="page-title" style={{ marginTop: 4 }}>Welcome back aboard</h1>
            <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
              Sign in to see trips, the work list, and everything below decks.
            </p>
          </div>

          {demo && (
            <div className="card card-pad" role="note" style={{ marginBottom: 16, background: 'var(--paper-2)' }}>
              <span className="flex items-center gap-8">
                <Icon name="info" s={16} />
                This is a read-only demo — sign-in is disabled.
              </span>
            </div>
          )}

          {error && (
            <div
              className="card card-pad"
              role="alert"
              style={{ marginBottom: 16, borderColor: 'var(--sig-overdue)', background: 'var(--sig-overdue-bg)', color: 'var(--ink-800)' }}
            >
              <span className="flex items-center gap-8">
                <Icon name="alert" s={16} />
                {error}
              </span>
            </div>
          )}

          <form className="stack" onSubmit={submit} noValidate>
            <div className="stack" style={{ gap: 4 }}>
              <label className="eyebrow" htmlFor="login-username">Username</label>
              <input
                id="login-username"
                className="search-input"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                disabled={demo}
                onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="eyebrow" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                className="search-input"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={demo}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />
            </div>
            <button
              type="submit"
              className="btn btn-brass"
              disabled={busy || demo}
              style={{ justifyContent: 'center', marginTop: 4 }}
            >
              <Icon name="helm" s={16} />
              {busy ? 'Signing in…' : 'Log in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 15,
  color: 'var(--ink-900)',
  background: 'var(--paper)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--r-md)',
  padding: '9px 12px',
  width: '100%',
  boxSizing: 'border-box',
};
