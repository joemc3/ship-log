/**
 * Admin — OWNER-ONLY user administration. The route is guarded (RequireOwner) and
 * the API is owner-only server-side (403), so this page assumes an owner viewer
 * but still degrades gracefully if a fetch fails.
 *
 * It drives the four user endpoints through the typed client:
 *   - GET    /api/users               → the table
 *   - POST   /api/users               → add (username + temp password + role)
 *   - PUT    /api/users/:username     → set role and/or reset password
 *   - DELETE /api/users/:username     → remove
 *
 * The server owns the invariants (last-owner can't be demoted/deleted, no
 * duplicate username, min-8 passwords) and surfaces them as 409/404/400; we read
 * those messages straight back to the owner. After every successful mutation the
 * list is re-fetched so the table mirrors the authoritative server state. A new
 * user receives a TEMPORARY password the owner shares; the user changes it from
 * /account on first sign-in (we never see or store an existing password here).
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon.js';
import { api, ApiError } from '../lib/api.js';
import type { AssignableRole, User } from '../lib/types.js';

const ROLE_OPTIONS: { value: AssignableRole; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'crew', label: 'Crew' },
];

const MIN_PW = 8;

/** Read an ApiError's message (the server's 400/404/409 text) or a generic line. */
function msg(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function AdminPage(): JSX.Element {
  const [users, setUsers] = useState<User[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // The reset-password + delete modals are keyed by the target username.
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await api.listUsers();
      setUsers(list);
    } catch (err: unknown) {
      setLoadError(msg(err, 'Could not load the crew list.'));
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flash = (tone: 'ok' | 'bad', text: string): void => setNotice({ tone, text });

  /* ---- role change (PUT { role }) ---- */
  const changeRole = async (username: string, role: AssignableRole): Promise<void> => {
    setNotice(null);
    try {
      await api.updateUser(username, { role });
      flash('ok', `${username} is now ${role}.`);
      await refresh();
    } catch (err: unknown) {
      flash('bad', msg(err, 'Could not change that role.'));
      // Re-fetch so a rejected select reverts to the authoritative role.
      await refresh();
    }
  };

  /* ---- reset password (PUT { password }) ---- */
  const resetPassword = async (username: string, password: string): Promise<void> => {
    await api.updateUser(username, { password });
    flash('ok', `Password reset for ${username}.`);
    setResetFor(null);
    await refresh();
  };

  /* ---- delete (DELETE) ---- */
  const removeUser = async (username: string): Promise<void> => {
    await api.deleteUser(username);
    flash('ok', `${username} removed.`);
    setDeleteFor(null);
    await refresh();
  };

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 820 }}>
        <div className="page-head">
          <span className="eyebrow">Owner tools</span>
          <h1 className="page-title">Crew &amp; access</h1>
          <p className="page-lead">
            Add the people who help look after her, set who can edit and who can only read, and reset a
            password when someone is locked out.
          </p>
        </div>

        {notice && (
          <div
            className="card card-pad"
            data-testid="notice"
            role={notice.tone === 'ok' ? 'status' : 'alert'}
            style={{
              marginBottom: 18,
              borderColor: notice.tone === 'ok' ? 'var(--sig-good)' : 'var(--sig-overdue)',
              background: notice.tone === 'ok' ? 'var(--sig-good-bg)' : 'var(--sig-overdue-bg)',
              color: 'var(--ink-800)',
            }}
          >
            <span className="flex items-center gap-8">
              <Icon name={notice.tone === 'ok' ? 'check' : 'alert'} s={16} />
              {notice.text}
            </span>
          </div>
        )}

        {/* ---- users table ---- */}
        <div className="card" style={{ overflow: 'hidden', marginBottom: 26 }}>
          <div
            className="flex items-center"
            style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)', justifyContent: 'space-between' }}
          >
            <span className="eyebrow">Crew accounts</span>
            <span className="muted tiny">{users?.length ?? 0} {users?.length === 1 ? 'account' : 'accounts'}</span>
          </div>

          {users === null && <div className="muted" style={{ padding: '20px 18px' }}>Loading the crew list…</div>}
          {loadError && <div className="muted" role="alert" style={{ padding: '20px 18px' }}>{loadError}</div>}

          {users !== null &&
            users.map((u) => (
              <UserRow
                key={u.username}
                user={u}
                onRole={(role) => changeRole(u.username, role)}
                onReset={() => { setNotice(null); setResetFor(u.username); }}
                onDelete={() => { setNotice(null); setDeleteFor(u.username); }}
              />
            ))}
        </div>

        {/* ---- add user ---- */}
        <CreateUser onCreated={refresh} onFlash={flash} />
      </div>

      {resetFor && (
        <ResetPasswordModal
          username={resetFor}
          onClose={() => setResetFor(null)}
          onSubmit={(pw) => resetPassword(resetFor, pw)}
        />
      )}
      {deleteFor && (
        <ConfirmDeleteModal
          username={deleteFor}
          onClose={() => setDeleteFor(null)}
          onConfirm={() => removeUser(deleteFor)}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- user row */

function UserRow({
  user,
  onRole,
  onReset,
  onDelete,
}: {
  user: User;
  onRole: (role: AssignableRole) => void;
  onReset: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div
      className="flex items-center wrap"
      data-testid={`user-${user.username}`}
      style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', gap: 12, justifyContent: 'space-between' }}
    >
      <div className="flex items-center gap-12" style={{ minWidth: 0 }}>
        <span style={{ color: 'var(--brass-deep)' }}><Icon name="crew" s={18} /></span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{user.username}</div>
          <span
            className={`badge ${user.role === 'owner' ? 'scheduled' : 'plain'}`}
            data-testid={`role-${user.username}`}
            style={{ marginTop: 4 }}
          >
            <span className="dot" />{user.role === 'owner' ? 'Owner' : 'Crew'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-8 wrap">
        <label className="flex items-center gap-8">
          <span className="eyebrow" style={{ margin: 0 }}>Role</span>
          <select
            aria-label={`Role for ${user.username}`}
            className="picker-btn"
            value={user.role}
            onChange={(e) => onRole(e.target.value as AssignableRole)}
            style={selectStyle}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-ghost" onClick={onReset}>
          <Icon name="bolt" s={15} />Reset password
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label={`Delete ${user.username}`}
          onClick={onDelete}
          style={{ color: 'var(--sig-overdue)' }}
        >
          <Icon name="close" s={15} />Remove
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- create user */

function CreateUser({
  onCreated,
  onFlash,
}: {
  onCreated: () => Promise<void>;
  onFlash: (tone: 'ok' | 'bad', text: string) => void;
}): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AssignableRole>('crew');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (username.trim().length < 1) {
      setError('A username is required.');
      return;
    }
    if (password.length < MIN_PW) {
      setError(`The temporary password must be at least ${MIN_PW} characters.`);
      return;
    }
    setBusy(true);
    try {
      await api.createUser(username.trim(), password, role);
      onFlash('ok', `${username.trim()} added as ${role}.`);
      setUsername('');
      setPassword('');
      setRole('crew');
      await onCreated();
    } catch (err: unknown) {
      setError(msg(err, 'Could not add that user.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad">
      <span className="eyebrow">Add someone to the crew</span>
      <h2 className="page-title" style={{ fontSize: 22, margin: '4px 0 14px' }}>New account</h2>

      {error && (
        <div
          className="card card-pad"
          role="alert"
          style={{ marginBottom: 14, borderColor: 'var(--sig-overdue)', background: 'var(--sig-overdue-bg)', color: 'var(--ink-800)' }}
        >
          <span className="flex items-center gap-8"><Icon name="alert" s={16} />{error}</span>
        </div>
      )}

      <form className="stack" data-testid="create-user" onSubmit={submit} noValidate>
        <div className="stack" style={{ gap: 4 }}>
          <label className="eyebrow" htmlFor="new-username">Username</label>
          <input
            id="new-username"
            type="text"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="eyebrow" htmlFor="new-password">Temporary password</label>
          <input
            id="new-password"
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
          <span className="muted tiny">At least {MIN_PW} characters. They’ll change it on first sign-in.</span>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="eyebrow" htmlFor="new-role">Role</label>
          <select
            id="new-role"
            value={role}
            onChange={(e) => setRole(e.target.value as AssignableRole)}
            style={selectStyle}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-brass" disabled={busy} style={{ justifyContent: 'center', marginTop: 4 }}>
          <Icon name="plus" s={16} />{busy ? 'Adding…' : 'Add user'}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ modals */

function ResetPasswordModal({
  username,
  onClose,
  onSubmit,
}: {
  username: string;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
}): JSX.Element {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < MIN_PW) {
      setError(`The new password must be at least ${MIN_PW} characters.`);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(password);
    } catch (err: unknown) {
      setError(msg(err, 'Could not reset that password.'));
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose} style={{ alignItems: 'center', paddingTop: 0 }}>
      <form
        className="card fade-in stack"
        style={{ width: 'min(420px,92vw)', padding: 24 }}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-label={`Reset password for ${username}`}
      >
        <div className="flex items-center gap-12">
          <span style={{ color: 'var(--brass-deep)' }}><Icon name="bolt" s={20} /></span>
          <h3 style={{ fontSize: 20 }}>Reset password</h3>
          <button type="button" className="btn btn-ghost" aria-label="Close" onClick={onClose} style={{ marginLeft: 'auto', padding: '4px 8px' }}>
            <Icon name="close" s={16} />
          </button>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          Set a temporary password for <strong>{username}</strong>. Share it with them; they’ll change it from
          their account.
        </p>

        {error && (
          <div className="card card-pad" role="alert" style={{ borderColor: 'var(--sig-overdue)', background: 'var(--sig-overdue-bg)', color: 'var(--ink-800)' }}>
            <span className="flex items-center gap-8"><Icon name="alert" s={16} />{error}</span>
          </div>
        )}

        <div className="stack" style={{ gap: 4 }}>
          <label className="eyebrow" htmlFor="reset-password">New password</label>
          <input
            id="reset-password"
            type="text"
            autoComplete="off"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
          <span className="muted tiny">At least {MIN_PW} characters.</span>
        </div>
        <div className="flex gap-8" style={{ marginTop: 4 }}>
          <button type="submit" className="btn btn-brass" disabled={busy}>
            <Icon name="check" s={16} />{busy ? 'Resetting…' : 'Reset'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDeleteModal({
  username,
  onClose,
  onConfirm,
}: {
  username: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err: unknown) {
      // The server's guard message (409 last-owner/self, 404 gone) reads back
      // here in the modal; the row stays so the owner can retry or cancel.
      setError(msg(err, 'Could not remove that user.'));
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose} style={{ alignItems: 'center', paddingTop: 0 }}>
      <div
        className="card fade-in stack"
        style={{ width: 'min(420px,92vw)', padding: 24 }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Remove ${username}`}
      >
        <div className="flex items-center gap-12">
          <span style={{ color: 'var(--sig-overdue)' }}><Icon name="alert" s={20} /></span>
          <h3 style={{ fontSize: 20 }}>Remove {username}?</h3>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          This deletes their account and sign-in. It can’t be undone — they’ll need a fresh invite to return.
        </p>

        {error && (
          <div className="card card-pad" role="alert" style={{ borderColor: 'var(--sig-overdue)', background: 'var(--sig-overdue-bg)', color: 'var(--ink-800)' }}>
            <span className="flex items-center gap-8"><Icon name="alert" s={16} />{error}</span>
          </div>
        )}

        <div className="flex gap-8" style={{ marginTop: 4 }}>
          <button type="button" className="btn btn-brass" onClick={confirm} disabled={busy} style={{ background: 'var(--sig-overdue)', borderColor: 'var(--sig-overdue)' }}>
            <Icon name="close" s={16} />{busy ? 'Removing…' : 'Delete'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ styles */

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

const selectStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  color: 'var(--ink-900)',
  background: 'var(--paper)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--r-md)',
  padding: '7px 10px',
  cursor: 'pointer',
};
