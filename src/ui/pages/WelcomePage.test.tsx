import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import WelcomePage from './WelcomePage.js';
import { useSession, type Session } from '../state/session.js';
import { api } from '../lib/api.js';
import type { Welcome } from '../lib/types.js';

// The page learns its role from the session context and its data from
// GET /api/welcome — the ONLY block a guest is allowed to see. Mock both, the
// same way the Shell/session tests do.
vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});

vi.mock('../lib/api.js', () => ({
  api: { welcome: vi.fn() },
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

// Demo-shaped fixture mirroring the real /api/welcome contract (curated fields
// only — NO specs, NO tagline; those live in boat.yaml and are NOT spread here).
const FULL: Welcome = {
  name: 'Valkyrie',
  make: 'Catalina',
  model: '25',
  year: 1985,
  hailingPort: 'Gull Point',
  welcome: {
    rules: [
      'Life jackets on deck under way.',
      'One hand for you, one for the boat.',
    ],
    whatToExpect: 'A relaxed day sail on a classic Catalina 25 out of Gull Point.',
    whatToBring: [
      'Soft-soled non-marking shoes',
      'Sun protection (hat, sunglasses, sunscreen)',
      'A layer for the afternoon sea breeze',
    ],
    safety: 'PFDs are stowed under the V-berth (sizes S-XL).',
  },
};

function renderWelcome(s: Session): void {
  mockedUseSession.mockReturnValue(s);
  render(
    <MemoryRouter>
      <WelcomePage />
    </MemoryRouter>,
  );
}

describe('WelcomePage', () => {
  beforeEach(() => {
    mockedUseSession.mockReset();
    mockedApi.welcome.mockReset();
    mockedApi.welcome.mockResolvedValue(FULL);
  });
  afterEach(() => vi.clearAllMocks());

  it('renders the boat identity from /api/welcome (no hardcoded boat strings)', async () => {
    renderWelcome(session({}));
    // Name is the hero headline.
    expect(await screen.findByRole('heading', { name: 'Valkyrie' })).toBeInTheDocument();
    // make/model/year/hailingPort all come from the curated block.
    expect(screen.getByText(/1985 Catalina 25/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Gull Point/i).length).toBeGreaterThan(0);
  });

  it('fetches the welcome block on mount', async () => {
    renderWelcome(session({}));
    await waitFor(() => expect(mockedApi.welcome).toHaveBeenCalledTimes(1));
  });

  it('renders every house rule from welcome.rules', async () => {
    renderWelcome(session({}));
    for (const rule of FULL.welcome.rules!) {
      expect(await screen.findByText(rule)).toBeInTheDocument();
    }
  });

  it('renders the whatToExpect narrative and the whatToBring list', async () => {
    renderWelcome(session({}));
    expect(await screen.findByText(FULL.welcome.whatToExpect!)).toBeInTheDocument();
    for (const item of FULL.welcome.whatToBring!) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
  });

  it('renders the safety block', async () => {
    renderWelcome(session({}));
    expect(await screen.findByText(FULL.welcome.safety!)).toBeInTheDocument();
  });

  it('shows a Log in affordance for an anonymous guest', async () => {
    renderWelcome(session({ role: 'guest' }));
    const login = await screen.findByRole('link', { name: /log in/i });
    expect(login).toBeInTheDocument();
    expect(login).toHaveAttribute('href', '/login');
  });

  it('hides the Log in affordance for an authed viewer', async () => {
    renderWelcome(session({ role: 'owner', isOwner: true, isAuthed: true, username: 'cap' }));
    await screen.findByRole('heading', { name: 'Valkyrie' });
    expect(screen.queryByRole('link', { name: /log in/i })).not.toBeInTheDocument();
  });

  it('hides the Log in affordance in demo mode (sign-in disabled)', async () => {
    renderWelcome(session({ role: 'owner', isOwner: true, isAuthed: true, demo: true }));
    await screen.findByRole('heading', { name: 'Valkyrie' });
    expect(screen.queryByRole('link', { name: /log in/i })).not.toBeInTheDocument();
  });

  it('opens the Share modal from the hero share button (the share hook)', async () => {
    renderWelcome(session({}));
    const shareBtn = await screen.findByRole('button', { name: /share this page/i });
    await userEvent.click(shareBtn);
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText(/valkyrie/i)).toBeInTheDocument();
    // The modal exposes the shareable link to copy.
    expect(within(modal).getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('closes the Share modal on its close control', async () => {
    renderWelcome(session({}));
    await userEvent.click(await screen.findByRole('button', { name: /share this page/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('degrades gracefully when the welcome block is empty (missing curated fields)', async () => {
    mockedApi.welcome.mockResolvedValue({ name: 'Sea Otter', welcome: {} });
    renderWelcome(session({}));
    // Identity still renders.
    expect(await screen.findByRole('heading', { name: 'Sea Otter' })).toBeInTheDocument();
    // No rules/expect/bring/safety section headings when their data is absent.
    expect(screen.queryByText(/before you step aboard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/what to expect/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pack a soft bag/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/safety/i)).not.toBeInTheDocument();
    // No crash, and the page still mounts.
    expect(screen.getByText('Sea Otter')).toBeInTheDocument();
  });

  it('never renders any monetary / cost affordance (welcome is cost-free)', async () => {
    renderWelcome(session({ role: 'crew', isCrew: true, isAuthed: true }));
    await screen.findByRole('heading', { name: 'Valkyrie' });
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cost/i)).not.toBeInTheDocument();
  });

  it('renders a real hero <img> pointing at /api/welcome/hero when heroPhoto is set', async () => {
    mockedApi.welcome.mockResolvedValue({ ...FULL, heroPhoto: 'photos/boat-hero.jpg' });
    renderWelcome(session({}));
    const img = await screen.findByRole('img', { name: /valkyrie under sail/i });
    expect(img).toHaveAttribute('src', '/api/welcome/hero');
  });

  it('falls back to the placeholder (no hero <img>) when heroPhoto is absent', async () => {
    // FULL has no heroPhoto.
    renderWelcome(session({}));
    await screen.findByRole('heading', { name: 'Valkyrie' });
    expect(screen.queryByRole('img', { name: /valkyrie under sail/i })).not.toBeInTheDocument();
  });

  it('shows a loading state before the welcome block resolves', () => {
    let resolve!: (w: Welcome) => void;
    mockedApi.welcome.mockReturnValue(new Promise<Welcome>((r) => { resolve = r; }));
    renderWelcome(session({}));
    expect(screen.getByTestId('welcome-loading')).toBeInTheDocument();
    resolve(FULL);
  });
});
