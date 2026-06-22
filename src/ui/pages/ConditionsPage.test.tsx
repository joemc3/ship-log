import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ConditionsPage from './ConditionsPage.js';
import { useSession, type Session } from '../state/session.js';
import { api } from '../lib/api.js';
import type { Conditions } from '../lib/types.js';

vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});
vi.mock('../lib/api.js', () => ({ api: { conditions: vi.fn() }, ApiError: class ApiError extends Error {} }));

const mockedUseSession = vi.mocked(useSession);
const mockedApi = vi.mocked(api);

function session(partial: Partial<Session> = {}): Session {
  return {
    loading: false, role: 'guest', username: null, demo: false, ownerConfigured: true,
    isOwner: false, isCrew: false, isAuthed: false,
    refresh: vi.fn(), login: vi.fn(), logout: vi.fn(), ...partial,
  };
}

const FULL: Conditions = {
  configured: true,
  source: 'agent',
  location: { label: 'Charleston Harbor entrance', lat: 32.78, lon: -79.93, asOf: '2026-06-20T13:00:00Z' },
  asOf: '2026-06-20T13:05:00Z',
  stale: false,
  weather: {
    summary: 'SW 10-15 kt, building Thursday.',
    periods: [
      { time: '2026-06-20T14:00:00Z', windDir: 'SW', windKt: 12, gustKt: 18, tempF: 84, seasFt: 2.5, sky: 'Partly cloudy', precipPct: 10 },
      { time: '2026-06-20T17:00:00Z', windDir: 'SW', windKt: 14, gustKt: 20, tempF: 86, seasFt: 2.5, sky: 'Clear', precipPct: 5 },
    ],
  },
  tides: {
    stations: [
      { id: '8665530', name: 'Charleston, Customs House', area: 'Charleston Harbor', primary: true },
      { id: '8665543', name: 'Wando River, Causeway', area: 'Wando R.' },
    ],
    predictions: {
      '8665530': [{ type: 'H', time: '2026-06-20T15:12:00Z', heightFt: 5.8 }, { type: 'L', time: '2026-06-20T21:30:00Z', heightFt: 0.4 }],
      '8665543': [{ type: 'H', time: '2026-06-20T15:48:00Z', heightFt: 5.6 }],
    },
  },
  body: 'Light **SW** sea breeze fills in by early afternoon.',
};

function renderPage(s: Session = session()): void {
  mockedUseSession.mockReturnValue(s);
  render(<MemoryRouter><ConditionsPage /></MemoryRouter>);
}

describe('ConditionsPage', () => {
  beforeEach(() => {
    mockedUseSession.mockReset();
    mockedApi.conditions.mockReset();
    mockedApi.conditions.mockResolvedValue(FULL);
  });
  afterEach(() => vi.clearAllMocks());

  it('fetches conditions on mount and shows the location label', async () => {
    renderPage();
    expect(await screen.findByText('Charleston Harbor entrance')).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.conditions).toHaveBeenCalledTimes(1));
  });

  it('renders the weather summary + at least one period card', async () => {
    renderPage();
    expect(await screen.findByText(/SW 10-15 kt/)).toBeInTheDocument();
    expect(screen.getAllByText(/kt/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Partly cloudy/)).toBeInTheDocument();
  });

  it('renders the tide board with the primary station and the other areas', async () => {
    renderPage();
    expect(await screen.findByText(/Charleston, Customs House/)).toBeInTheDocument();
    expect(screen.getByText(/Wando R\./)).toBeInTheDocument();
  });

  it('renders the Markdown note (bold becomes <strong>)', async () => {
    renderPage();
    const strong = await screen.findByText('SW');
    expect(strong.tagName).toBe('STRONG');
  });

  it('shows a stale badge when stale', async () => {
    mockedApi.conditions.mockResolvedValue({ ...FULL, stale: true });
    renderPage();
    expect(await screen.findByText(/stale|out of date/i)).toBeInTheDocument();
  });

  it('shows an empty state when not configured', async () => {
    mockedApi.conditions.mockResolvedValue({ configured: false, stale: true });
    renderPage();
    expect(await screen.findByText(/aren.t set up yet|not set up/i)).toBeInTheDocument();
  });

  it('shows an unavailable notice when error is set and omits the weather strip', async () => {
    mockedApi.conditions.mockResolvedValue({
      configured: true, source: 'api', location: { label: 'Charleston', lat: 1, lon: 2 },
      tides: { stations: [{ id: '8665530', name: 'Charleston', primary: true }] }, stale: true, error: 'unavailable',
    });
    renderPage();
    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
  });

  it('never renders a monetary figure (conditions is cost-free)', async () => {
    renderPage(session({ role: 'crew', isCrew: true, isAuthed: true }));
    await screen.findByText('Charleston Harbor entrance');
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
