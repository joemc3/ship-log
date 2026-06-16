import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './AppRouter.js';
import { useSession, type Session } from './state/session.js';

// Mock the session so each test drives the guard matrix with a fixed role.
vi.mock('./state/session.js', async (orig) => {
  const actual = await orig<typeof import('./state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});

// Replace the Shell layout with a thin passthrough that just renders the matched
// child route (Outlet), so guard tests exercise routing/guards, not Shell's
// data-fetching chrome.
vi.mock('./components/Shell.js', () => ({
  Shell: ({ children }: { children?: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));

// This is a GUARD-MATRIX test: it asserts which page each role can reach, not how
// any page renders. Mock every routed page to a thin marker so the assertions are
// decoupled from page internals (which fetch data + have loading states) and stay
// stable as the real pages land. Each marker is `page:<name>`; the LoginPage keeps
// its own placeholder text since the LoginRoute logic (not a page) is under test.
function pageMock(name: string) {
  return { default: () => <div data-testid={`page-${name}`}>{`page:${name}`}</div> };
}
vi.mock('./pages/WelcomePage.js', () => pageMock('welcome'));
vi.mock('./pages/TripsPage.js', () => pageMock('trips'));
vi.mock('./pages/MaintenancePage.js', () => pageMock('maintenance'));
vi.mock('./pages/InventoryPage.js', () => pageMock('inventory'));
vi.mock('./pages/ManualsPage.js', () => pageMock('manuals'));
vi.mock('./pages/VendorsPage.js', () => pageMock('vendors'));
vi.mock('./pages/CostsPage.js', () => pageMock('costs'));
vi.mock('./pages/AdminPage.js', () => pageMock('admin'));
vi.mock('./pages/SearchPage.js', () => pageMock('search'));
vi.mock('./pages/AccountPage.js', () => pageMock('account'));
vi.mock('./pages/LoginPage.js', () => ({
  default: () => <div data-testid="page-login">TODO: Login</div>,
}));

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

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

const GUEST = session({ role: 'guest' });
const CREW = session({ role: 'crew', isCrew: true, isAuthed: true, username: 'crew1' });
const OWNER = session({ role: 'owner', isOwner: true, isAuthed: true, username: 'cap' });
const DEMO = session({ role: 'owner', isOwner: true, isAuthed: true, demo: true });

describe('AppRouter guard matrix', () => {
  beforeEach(() => mockedUseSession.mockReset());

  it('guest may see Welcome at /', () => {
    mockedUseSession.mockReturnValue(GUEST);
    renderAt('/');
    expect(screen.getByTestId('page-welcome')).toBeInTheDocument();
  });

  it('guest may see the Login page', () => {
    mockedUseSession.mockReturnValue(GUEST);
    renderAt('/login');
    expect(screen.getByTestId('page-login')).toBeInTheDocument();
  });

  it('guest is redirected away from a gated route to /login', () => {
    mockedUseSession.mockReturnValue(GUEST);
    renderAt('/trips');
    expect(screen.getByTestId('page-login')).toBeInTheDocument();
    expect(screen.queryByTestId('page-trips')).not.toBeInTheDocument();
  });

  it('crew may reach Trips/Maintenance/Inventory/Manuals/Vendors', () => {
    mockedUseSession.mockReturnValue(CREW);
    for (const [path, testid] of [
      ['/trips', 'page-trips'],
      ['/maintenance', 'page-maintenance'],
      ['/inventory', 'page-inventory'],
      ['/manuals', 'page-manuals'],
      ['/vendors', 'page-vendors'],
    ] as const) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>,
      );
      expect(screen.getByTestId(testid)).toBeInTheDocument();
      unmount();
    }
  });

  it('crew is blocked from /costs (owner-only) and redirected', () => {
    mockedUseSession.mockReturnValue(CREW);
    renderAt('/costs');
    expect(screen.queryByTestId('page-costs')).not.toBeInTheDocument();
  });

  it('crew is blocked from /admin (owner-only) and redirected', () => {
    mockedUseSession.mockReturnValue(CREW);
    renderAt('/admin');
    expect(screen.queryByTestId('page-admin')).not.toBeInTheDocument();
  });

  it('owner may reach /costs and /admin', () => {
    mockedUseSession.mockReturnValue(OWNER);
    renderAt('/costs');
    expect(screen.getByTestId('page-costs')).toBeInTheDocument();
  });

  it('owner may reach /admin', () => {
    mockedUseSession.mockReturnValue(OWNER);
    renderAt('/admin');
    expect(screen.getByTestId('page-admin')).toBeInTheDocument();
  });

  it('demo viewer (owner-equivalent) may reach /costs', () => {
    mockedUseSession.mockReturnValue(DEMO);
    renderAt('/costs');
    expect(screen.getByTestId('page-costs')).toBeInTheDocument();
  });

  it('demo viewer is bounced off /login back to Welcome (login disabled)', () => {
    mockedUseSession.mockReturnValue(DEMO);
    renderAt('/login');
    expect(screen.getByTestId('page-welcome')).toBeInTheDocument();
    expect(screen.queryByTestId('page-login')).not.toBeInTheDocument();
  });

  it('authed owner visiting /login is sent home (already signed in)', () => {
    mockedUseSession.mockReturnValue(OWNER);
    renderAt('/login');
    expect(screen.queryByTestId('page-login')).not.toBeInTheDocument();
  });

  it('a record deep-link /trips/:id renders the gated page for crew', () => {
    mockedUseSession.mockReturnValue(CREW);
    renderAt('/trips/t-2026-05-09');
    expect(screen.getByTestId('page-trips')).toBeInTheDocument();
  });

  it('shows a loading placeholder while the session resolves', () => {
    mockedUseSession.mockReturnValue(session({ loading: true }));
    renderAt('/trips');
    expect(screen.getByTestId('session-loading')).toBeInTheDocument();
  });
});
