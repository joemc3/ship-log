import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Shell } from './Shell.js';
import { useSession, type Session } from '../state/session.js';
import { api } from '../lib/api.js';

vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});

vi.mock('../lib/api.js', () => ({
  api: {
    welcome: vi.fn(),
    boat: vi.fn(),
    derived: vi.fn(),
    search: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const mockedUseSession = vi.mocked(useSession);
const mockedApi = vi.mocked(api);

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

function renderShell(s: Session): void {
  mockedUseSession.mockReturnValue(s);
  render(
    <MemoryRouter>
      <Shell><div data-testid="page-content">page</div></Shell>
    </MemoryRouter>,
  );
}

describe('Shell', () => {
  beforeEach(() => {
    mockedUseSession.mockReset();
    mockedApi.welcome.mockResolvedValue({ name: 'Valkyrie', welcome: {} });
    mockedApi.boat.mockResolvedValue({ name: 'Valkyrie' });
    mockedApi.derived.mockResolvedValue({ attention: 0, inventoryTasks: [] });
    mockedApi.search.mockResolvedValue([]);
  });
  afterEach(() => vi.clearAllMocks());

  it('renders the brand name from /api/welcome (not a hardcoded value)', async () => {
    mockedApi.welcome.mockResolvedValue({ name: 'Sea Otter', welcome: {} });
    renderShell(session({ role: 'owner', isOwner: true, isAuthed: true }));
    // The boat name appears in both the sidebar brand mark and the topbar crumb;
    // assert the canonical brand-name node so the duplicate doesn't trip getByText.
    await waitFor(() => {
      expect(document.querySelector('.brand-name')).toHaveTextContent('Sea Otter');
    });
  });

  it('renders the page content it wraps', () => {
    renderShell(session({ role: 'owner', isOwner: true, isAuthed: true }));
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('owner sees the Costs and Admin nav items', async () => {
    renderShell(session({ role: 'owner', isOwner: true, isAuthed: true, username: 'cap' }));
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('link', { name: /Costs/i })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Admin/i })).toBeInTheDocument();
  });

  it('crew does NOT see Costs or Admin (owner-only)', async () => {
    renderShell(session({ role: 'crew', isCrew: true, isAuthed: true, username: 'crew1' }));
    const nav = await screen.findByRole('navigation');
    expect(within(nav).queryByRole('link', { name: /Costs/i })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /Admin/i })).not.toBeInTheDocument();
    // but still sees the shared operations items
    expect(within(nav).getByRole('link', { name: /Maintenance/i })).toBeInTheDocument();
  });

  it('guest sees a Login affordance and no operations items', async () => {
    renderShell(session({ role: 'guest' }));
    expect(await screen.findByRole('link', { name: /Log in/i })).toBeInTheDocument();
    const nav = screen.queryByRole('navigation');
    if (nav) {
      expect(within(nav).queryByRole('link', { name: /Costs/i })).not.toBeInTheDocument();
    }
  });

  it('authed viewer sees their username and a logout control', async () => {
    const logout = vi.fn();
    renderShell(session({ role: 'owner', isOwner: true, isAuthed: true, username: 'cap', logout }));
    expect(await screen.findByText('cap')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /log out/i });
    await userEvent.click(btn);
    expect(logout).toHaveBeenCalled();
  });

  it('renders a persistent DEMO banner when in demo mode', async () => {
    renderShell(session({ role: 'owner', isOwner: true, isAuthed: true, demo: true }));
    expect(await screen.findByText(/demo/i)).toBeInTheDocument();
    // login affordance is hidden in demo
    expect(screen.queryByRole('link', { name: /Log in/i })).not.toBeInTheDocument();
  });

  it('shows the maintenance nav-badge from derived.attention', async () => {
    mockedApi.derived.mockResolvedValue({ attention: 4, inventoryTasks: [] });
    renderShell(session({ role: 'owner', isOwner: true, isAuthed: true }));
    await waitFor(() => expect(screen.getByText('4')).toBeInTheDocument());
    expect(screen.getByText('4')).toHaveClass('nav-badge');
  });

  it('hides the badge when attention is 0', async () => {
    mockedApi.derived.mockResolvedValue({ attention: 0, inventoryTasks: [] });
    renderShell(session({ role: 'owner', isOwner: true, isAuthed: true }));
    await screen.findByRole('navigation');
    expect(document.querySelector('.nav-badge')).toBeNull();
  });

  it('opens the search overlay from the search pill and queries the API', async () => {
    mockedApi.search.mockResolvedValue([
      { collection: 'trip', id: 't-2026-05-09', title: 'Dawn passage' },
    ]);
    renderShell(session({ role: 'owner', isOwner: true, isAuthed: true }));
    await userEvent.click(await screen.findByRole('button', { name: /search/i }));
    const input = await screen.findByPlaceholderText(/search/i);
    await userEvent.type(input, 'dawn');
    await waitFor(() => expect(mockedApi.search).toHaveBeenCalledWith('dawn'));
    expect(await screen.findByText('Dawn passage')).toBeInTheDocument();
  });

  it('does not query search for a guest (no haystack access)', async () => {
    renderShell(session({ role: 'guest' }));
    // guest has no search pill at all
    expect(screen.queryByRole('button', { name: /search the whole boat/i })).not.toBeInTheDocument();
  });

  it('opens the Share modal from the sidebar', async () => {
    renderShell(session({ role: 'owner', isOwner: true, isAuthed: true }));
    await userEvent.click(await screen.findByRole('button', { name: /share welcome page/i }));
    // The modal heading carries the boat name + "welcome page"; assert the H3.
    expect(await screen.findByRole('heading', { name: /share .*welcome page/i })).toBeInTheDocument();
  });

  it('hides the Purser nav item when assistantEnabled is false', async () => {
    renderShell(session({ role: 'crew', isCrew: true, isAuthed: true, assistantEnabled: false }));
    await screen.findByTestId('page-content');
    expect(screen.queryByRole('link', { name: /purser/i })).toBeNull();
  });

  it('shows the Purser nav item with its label when enabled', async () => {
    renderShell(session({ role: 'crew', isCrew: true, isAuthed: true, assistantEnabled: true, assistantLabel: 'Ask the Purser' }));
    expect(await screen.findByRole('link', { name: /ask the purser/i })).toBeInTheDocument();
  });
});

/* Regression guard for the mobile drawer: the .scrim backdrop must stack BELOW
 * the .sidebar drawer (and above the .topbar), otherwise the full-screen scrim
 * paints over the open drawer — dimming it and swallowing every nav click, so
 * the mobile menu opens but nothing inside it is clickable. jsdom does not
 * compute z-index stacking or hit-testing, so we pin the invariant at the CSS
 * source. */
describe('mobile drawer stacking (app.css)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/styles/app.css'), 'utf8');

  const zIndexOf = (selector: string): number => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    const body = block?.[1];
    expect(body, `expected a CSS rule for ${selector}`).toBeDefined();
    const z = /z-index:\s*(-?\d+)/.exec(body ?? '');
    const value = z?.[1];
    expect(value, `expected a z-index on ${selector}`).toBeDefined();
    return Number(value);
  };

  it('renders the drawer above its backdrop and the backdrop above the topbar', () => {
    const scrim = zIndexOf('.scrim');
    const sidebar = zIndexOf('.sidebar');
    const topbar = zIndexOf('.topbar');
    expect(scrim).toBeLessThan(sidebar);
    expect(scrim).toBeGreaterThan(topbar);
  });
});

/* Regression guard for the mobile drawer scroll: the drawer is a fixed-height
 * flex column (.sidebar) with a pinned brand on top and a pinned foot at the
 * bottom (Share + the login/change-password/logout block). The .nav list
 * between them must be the scroll region, or a tall menu pushes the foot off
 * the bottom of the screen with no way to reach it. For overflow-y to actually
 * scroll inside a flex column, .nav needs flex-grow AND min-height:0 (the
 * default min-height:auto refuses to shrink below content). jsdom does not do
 * layout, so we pin these properties at the CSS source. */
describe('mobile drawer scroll (app.css)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/styles/app.css'), 'utf8');
  const navBody = (/\.nav\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').replace(/\s+/g, ' ');

  it('makes the .nav list a flexible, scrollable region', () => {
    expect(navBody, 'expected a .nav CSS rule').not.toBe('');
    expect(navBody).toMatch(/overflow-y:\s*auto/);
    expect(navBody).toMatch(/min-height:\s*0/);
    expect(navBody).toMatch(/flex(-grow)?:\s*1/);
  });
});
