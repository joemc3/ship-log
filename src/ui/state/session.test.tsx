import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SessionProvider, useSession } from './session.js';
import { api } from '../lib/api.js';
import type { Me, LoginResult } from '../lib/types.js';

vi.mock('../lib/api.js', () => ({
  api: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const mockedMe = vi.mocked(api.me);
const mockedLogin = vi.mocked(api.login);
const mockedLogout = vi.mocked(api.logout);

function Probe(): JSX.Element {
  const s = useSession();
  return (
    <div>
      <span data-testid="status">{s.loading ? 'loading' : 'ready'}</span>
      <span data-testid="role">{s.role}</span>
      <span data-testid="isOwner">{String(s.isOwner)}</span>
      <span data-testid="isCrew">{String(s.isCrew)}</span>
      <span data-testid="isAuthed">{String(s.isAuthed)}</span>
      <span data-testid="demo">{String(s.demo)}</span>
      <span data-testid="ownerConfigured">{String(s.ownerConfigured)}</span>
      <span data-testid="username">{s.username ?? ''}</span>
      <button onClick={() => void s.login('cap', 'pw')}>login</button>
      <button onClick={() => void s.logout()}>logout</button>
    </div>
  );
}

function renderSession(): void {
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
}

const GUEST: Me = { role: 'guest', username: null, demo: false, ownerConfigured: true };
const OWNER: Me = { role: 'owner', username: 'cap', demo: false, ownerConfigured: true };
const DEMO: Me = { role: 'owner', username: null, demo: true, ownerConfigured: false };
const NO_OWNER: Me = { role: 'guest', username: null, demo: false, ownerConfigured: false };

describe('SessionProvider', () => {
  beforeEach(() => {
    mockedMe.mockReset();
    mockedLogin.mockReset();
    mockedLogout.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('starts loading, then resolves the guest role from GET /api/me', async () => {
    mockedMe.mockResolvedValue(GUEST);
    renderSession();
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('role')).toHaveTextContent('guest');
    expect(screen.getByTestId('isAuthed')).toHaveTextContent('false');
    expect(screen.getByTestId('isOwner')).toHaveTextContent('false');
  });

  it('reflects owner role + isAuthed/isOwner true', async () => {
    mockedMe.mockResolvedValue(OWNER);
    renderSession();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('owner'));
    expect(screen.getByTestId('isOwner')).toHaveTextContent('true');
    expect(screen.getByTestId('isAuthed')).toHaveTextContent('true');
    expect(screen.getByTestId('isCrew')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toHaveTextContent('cap');
  });

  it('surfaces the demo flag (viewer is owner-equivalent)', async () => {
    mockedMe.mockResolvedValue(DEMO);
    renderSession();
    await waitFor(() => expect(screen.getByTestId('demo')).toHaveTextContent('true'));
    expect(screen.getByTestId('isOwner')).toHaveTextContent('true');
  });

  it('surfaces ownerConfigured=false for the bootstrap banner trigger', async () => {
    mockedMe.mockResolvedValue(NO_OWNER);
    renderSession();
    await waitFor(() => expect(screen.getByTestId('ownerConfigured')).toHaveTextContent('false'));
  });

  it('transitions guest -> authed after login() (login then refresh /api/me)', async () => {
    mockedMe.mockResolvedValueOnce(GUEST);
    renderSession();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('guest'));

    const loginRes: LoginResult = { username: 'cap', role: 'owner' };
    mockedLogin.mockResolvedValue(loginRes);
    mockedMe.mockResolvedValue(OWNER); // refresh after login
    await act(async () => {
      screen.getByText('login').click();
    });
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('owner'));
    expect(mockedLogin).toHaveBeenCalledWith('cap', 'pw');
    expect(screen.getByTestId('isAuthed')).toHaveTextContent('true');
  });

  it('transitions authed -> guest after logout()', async () => {
    mockedMe.mockResolvedValueOnce(OWNER);
    renderSession();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('owner'));

    mockedLogout.mockResolvedValue(undefined);
    mockedMe.mockResolvedValue(GUEST); // refresh after logout
    await act(async () => {
      screen.getByText('logout').click();
    });
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('guest'));
    expect(mockedLogout).toHaveBeenCalled();
  });
});
