/**
 * Account — the change-password screen any authenticated user reaches (from the
 * sidebar "Change password" link). It POSTs /api/password
 * {currentPassword,newPassword} via the typed client. The server enforces a
 * min-8 newPassword and rejects a wrong currentPassword (both 400); we mirror
 * the min-8 rule client-side so an obviously-too-short password never round-trips,
 * surface a clear success notice, and surface each server error verbatim.
 *
 * In demo mode the change is a server 400, so we show a read-only notice and
 * disable the control rather than fire a doomed request.
 */
import { useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon.js';
import { useSession } from '../state/session.js';
import { api, ApiError } from '../lib/api.js';

const MIN_LEN = 8;

export default function AccountPage(): JSX.Element {
  const { username, demo } = useSession();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || demo) return;
    setError(null);
    setDone(false);
    // Mirror the server's min-8 rule so an obviously-short password never
    // round-trips (the server is still the authority and re-checks it).
    if (next.length < MIN_LEN) {
      setError(`Your new password must be at least ${MIN_LEN} characters.`);
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 520 }}>
        <div className="page-head">
          <span className="eyebrow">Your account</span>
          <h1 className="page-title">Account</h1>
          <p className="page-lead">
            Signed in as <strong>{username ?? 'this account'}</strong>. Change your password below.
          </p>
        </div>

        {demo && (
          <div className="card card-pad" role="note" style={{ marginBottom: 16, background: 'var(--paper-2)' }}>
            <span className="flex items-center gap-8">
              <Icon name="info" s={16} />
              This is a read-only demo — changing your password is disabled.
            </span>
          </div>
        )}

        <div className="card card-pad">
          {done && (
            <div
              className="card card-pad"
              role="status"
              style={{ marginBottom: 16, borderColor: 'var(--sig-good)', background: 'var(--sig-good-bg)', color: 'var(--ink-800)' }}
            >
              <span className="flex items-center gap-8">
                <Icon name="check" s={16} />
                Your password has been updated.
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
              <label className="eyebrow" htmlFor="acct-current">Current password</label>
              <input
                id="acct-current"
                type="password"
                autoComplete="current-password"
                value={current}
                disabled={demo}
                onChange={(e) => setCurrent(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="eyebrow" htmlFor="acct-new">New password</label>
              <input
                id="acct-new"
                type="password"
                autoComplete="new-password"
                value={next}
                disabled={demo}
                onChange={(e) => setNext(e.target.value)}
                style={inputStyle}
              />
              <span className="muted tiny">At least {MIN_LEN} characters.</span>
            </div>
            <button
              type="submit"
              className="btn btn-brass"
              disabled={busy || demo}
              style={{ justifyContent: 'center', marginTop: 4 }}
            >
              <Icon name="check" s={16} />
              {busy ? 'Saving…' : 'Change password'}
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
