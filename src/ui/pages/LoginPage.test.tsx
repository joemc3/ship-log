/**
 * Component test for LoginPage, driven against a mocked session (`useSession`)
 * the same way WelcomePage's test mocks it. The page POSTs /api/login via
 * `session.login(username, password)`, then on success refreshes the session and
 * redirects into the app (the prior `from` location, defaulting to home).
 *
 * Auth UX contract:
 *   - a wrong username OR password yields the SAME generic message (no
 *     user-enumeration — we mirror the server's flat "invalid credentials" 401);
 *   - a 429 rate-limit reads back as a "too many attempts" notice, NOT a generic
 *     credential error, so the user knows to wait rather than re-typing;
 *   - in demo mode (which the route guard normally prevents reaching) the form is
 *     disabled with a notice — login is a server 400 there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import LoginPage from './LoginPage.js';
import { useSession, type Session } from '../state/session.js';
import { ApiError } from '../lib/api.js';

vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});

const mockedUseSession = vi.mocked(useSession);

function session(partial: Partial<Session>): Session {
  return {
    loading: false,
    role: 'guest',
    username: null,
    demo: false,
    ownerConfigured: true,
    isOwner: false,
    isCrew: false,
    isAuthed: false,
    refresh: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    ...partial,
  };
}

/** A probe at the redirect target so we can assert a successful login navigates. */
function HomeProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="home">{loc.pathname}</div>;
}

function renderLogin(initialEntry: { pathname: string; state?: unknown } = { pathname: '/login' }): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<HomeProbe />} />
        <Route path="/trips" element={<HomeProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedUseSession.mockReset();
});

describe('LoginPage — success', () => {
  it('submits credentials via session.login and redirects home on success', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue(undefined);
    mockedUseSession.mockReturnValue(session({ login }));
    renderLogin();

    await user.type(screen.getByLabelText(/username/i), 'cap');
    await user.type(screen.getByLabelText(/password/i), 'secretpass');
    await user.click(screen.getByRole('button', { name: /log in|sign in/i }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('cap', 'secretpass'));
    // On success the page leaves /login for the app.
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument());
  });

  it('redirects to the attempted (from) path after a deep-link login', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue(undefined);
    mockedUseSession.mockReturnValue(session({ login }));
    renderLogin({ pathname: '/login', state: { from: '/trips' } });

    await user.type(screen.getByLabelText(/username/i), 'cap');
    await user.type(screen.getByLabelText(/password/i), 'secretpass');
    await user.click(screen.getByRole('button', { name: /log in|sign in/i }));

    await waitFor(() => expect(screen.getByTestId('home')).toHaveTextContent('/trips'));
  });
});

describe('LoginPage — failures', () => {
  it('shows a generic credential error on 401 (no user enumeration)', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValue(new ApiError(401, 'invalid credentials'));
    mockedUseSession.mockReturnValue(session({ login }));
    renderLogin();

    await user.type(screen.getByLabelText(/username/i), 'ghost');
    await user.type(screen.getByLabelText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /log in|sign in/i }));

    const alert = await screen.findByRole('alert');
    // Generic — it must NOT reveal whether the username or the password was wrong.
    expect(alert).toHaveTextContent(/incorrect|invalid|check.*again|try again/i);
    expect(alert).not.toHaveTextContent(/no such user|unknown user|user not found/i);
    // Still on the login form (no redirect).
    expect(screen.queryByTestId('home')).not.toBeInTheDocument();
  });

  it('shows a rate-limit notice (not a credential error) on 429', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValue(new ApiError(429, 'too many'));
    mockedUseSession.mockReturnValue(session({ login }));
    renderLogin();

    await user.type(screen.getByLabelText(/username/i), 'cap');
    await user.type(screen.getByLabelText(/password/i), 'secretpass');
    await user.click(screen.getByRole('button', { name: /log in|sign in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/too many|wait|moment|try again later/i);
  });

  it('re-enables the submit button after a failed attempt', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValue(new ApiError(401, 'invalid credentials'));
    mockedUseSession.mockReturnValue(session({ login }));
    renderLogin();

    await user.type(screen.getByLabelText(/username/i), 'cap');
    await user.type(screen.getByLabelText(/password/i), 'nope');
    const btn = screen.getByRole('button', { name: /log in|sign in/i });
    await user.click(btn);

    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /log in|sign in/i })).not.toBeDisabled();
  });
});

describe('LoginPage — demo', () => {
  it('disables the form and shows a notice in demo mode', () => {
    mockedUseSession.mockReturnValue(session({ demo: true }));
    renderLogin();

    expect(screen.getByText(/demo/i)).toBeInTheDocument();
    // The submit control is disabled so a demo viewer cannot fire a doomed 400.
    expect(screen.getByRole('button', { name: /log in|sign in/i })).toBeDisabled();
  });
});
