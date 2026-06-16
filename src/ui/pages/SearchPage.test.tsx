import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import SearchPage from './SearchPage.js';
import { useSession, type Session } from '../state/session.js';
import { api } from '../lib/api.js';
import type { SearchHit } from '../lib/types.js';

// The page learns its role from the session context and its data from
// GET /api/search?q= (already role-redacted server-side). Mock both, the same
// way the WelcomePage/Shell tests do.
vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});

vi.mock('../lib/api.js', () => ({
  api: { search: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const mockedUseSession = vi.mocked(useSession);
const mockedSearch = vi.mocked(api.search);

function session(partial: Partial<Session>): Session {
  return {
    loading: false,
    role: 'owner',
    username: 'cap',
    demo: false,
    ownerConfigured: true,
    isOwner: true,
    isCrew: false,
    isAuthed: true,
    refresh: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    ...partial,
  };
}

/** A spy route so we can assert a hit deep-links to its owning page + record. */
function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="route-probe">{loc.pathname + loc.search}</div>;
}

function renderSearch(s: Session, initialPath = '/search'): void {
  mockedUseSession.mockReturnValue(s);
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/search" element={<SearchPage />} />
        {/* Probe routes for every collection's owning page. */}
        <Route path="/trips" element={<LocationProbe />} />
        <Route path="/maintenance" element={<LocationProbe />} />
        <Route path="/inventory" element={<LocationProbe />} />
        <Route path="/vendors" element={<LocationProbe />} />
        <Route path="/manuals" element={<LocationProbe />} />
        <Route path="/costs" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A mixed owner-shaped result set spanning several collections, including a
 *  cost hit (only an owner would ever receive one from the redacted server). */
const OWNER_HITS: SearchHit[] = [
  { collection: 'trip', id: 't-2026-05-09', title: 'Coastal passage to Heron Cove' },
  { collection: 'maintenance', id: 'm-impeller', title: 'Replace raw-water impeller' },
  { collection: 'inventory', id: 'inv-flares', title: 'Handheld flares' },
  { collection: 'vendor', id: 'v-harbor-marine', title: 'Harbor Marine' },
  { collection: 'manual', id: 'man-engine', title: 'Yanmar 2GM20 manual' },
  { collection: 'cost', id: 'c-impeller-2026', title: 'Raw-water impeller' },
];

/** A crew-shaped result set: the server already stripped every cost hit, so the
 *  page only ever sees the non-monetary collections. */
const CREW_HITS: SearchHit[] = [
  { collection: 'trip', id: 't-2026-05-09', title: 'Coastal passage to Heron Cove' },
  { collection: 'maintenance', id: 'm-impeller', title: 'Replace raw-water impeller' },
];

beforeEach(() => {
  mockedUseSession.mockReset();
  mockedSearch.mockReset();
  mockedSearch.mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe('SearchPage — query + results', () => {
  it('renders the page shell with a search input', () => {
    renderSearch(session({}));
    expect(screen.getByRole('heading', { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('does not call the API for an empty query', () => {
    renderSearch(session({}));
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('queries GET /api/search as the viewer types and groups the hits by collection', async () => {
    const user = userEvent.setup();
    mockedSearch.mockResolvedValue(OWNER_HITS);
    renderSearch(session({}));
    await user.type(screen.getByRole('searchbox'), 'impeller');

    await waitFor(() => expect(mockedSearch).toHaveBeenCalledWith('impeller'));
    // Hits render by title, grouped under their collection headings.
    expect(await screen.findByText('Coastal passage to Heron Cove')).toBeInTheDocument();
    expect(screen.getByText('Replace raw-water impeller')).toBeInTheDocument();
    expect(screen.getByText('Harbor Marine')).toBeInTheDocument();
    // Collection group headings carry the category label + a count (e.g. "Trip
    // logs · 1"); the same label also appears as each hit's per-row subtitle, so
    // we assert on the count-bearing group heading specifically.
    expect(screen.getByText(/Trip logs\s*·\s*1/i)).toBeInTheDocument();
    expect(screen.getByText(/Vendors\s*·\s*1/i)).toBeInTheDocument();
  });

  it('shows a no-results message when the API returns no hits', async () => {
    const user = userEvent.setup();
    mockedSearch.mockResolvedValue([]);
    renderSearch(session({}));
    await user.type(screen.getByRole('searchbox'), 'nonesuch');
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledWith('nonesuch'));
    expect(await screen.findByText(/nothing aboard matches/i)).toBeInTheDocument();
  });
});

describe('SearchPage — deep links', () => {
  it('deep-links a trip hit to /trips?focus=<id>', async () => {
    const user = userEvent.setup();
    mockedSearch.mockResolvedValue(OWNER_HITS);
    renderSearch(session({}));
    await user.type(screen.getByRole('searchbox'), 'heron');
    const hit = await screen.findByText('Coastal passage to Heron Cove');
    await user.click(hit);
    expect(screen.getByTestId('route-probe')).toHaveTextContent('/trips?focus=t-2026-05-09');
  });

  it('deep-links a vendor hit to /vendors?focus=<id>', async () => {
    const user = userEvent.setup();
    mockedSearch.mockResolvedValue(OWNER_HITS);
    renderSearch(session({}));
    await user.type(screen.getByRole('searchbox'), 'harbor');
    const hit = await screen.findByText('Harbor Marine');
    await user.click(hit);
    expect(screen.getByTestId('route-probe')).toHaveTextContent('/vendors?focus=v-harbor-marine');
  });

  it('deep-links a cost hit to /costs?focus=<id> for an owner', async () => {
    const user = userEvent.setup();
    mockedSearch.mockResolvedValue(OWNER_HITS);
    renderSearch(session({ role: 'owner', isOwner: true }));
    await user.type(screen.getByRole('searchbox'), 'impeller');
    const hit = await screen.findByText('Raw-water impeller');
    await user.click(hit);
    expect(screen.getByTestId('route-probe')).toHaveTextContent('/costs?focus=c-impeller-2026');
  });
});

describe('SearchPage — URL ?q= seeding + cmd-K', () => {
  it('seeds the input and runs the search from a ?q= query param', async () => {
    mockedSearch.mockResolvedValue(OWNER_HITS);
    renderSearch(session({}), '/search?q=impeller');
    // The input is pre-filled and the search fires on mount.
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledWith('impeller'));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('impeller');
    expect(await screen.findByText('Replace raw-water impeller')).toBeInTheDocument();
  });

  it('autofocuses the search input on mount (so cmd-K landing here is type-ready)', async () => {
    renderSearch(session({}));
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveFocus());
  });
});

describe('SearchPage — role / redaction posture', () => {
  it('crew: renders only the non-cost hits the server returned and shows no money', async () => {
    const user = userEvent.setup();
    mockedSearch.mockResolvedValue(CREW_HITS);
    renderSearch(session({ role: 'crew', isCrew: true, isOwner: false }));
    await user.type(screen.getByRole('searchbox'), 'impeller');
    expect(await screen.findByText('Replace raw-water impeller')).toBeInTheDocument();
    // No money rendered anywhere.
    expect(document.body).not.toHaveTextContent('$');
    // No Costs group (heading or per-row subtitle), since the server returned no
    // cost hits — the page never synthesizes a cost facet for crew.
    expect(screen.queryByText(/^Costs$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Costs\s*·/)).not.toBeInTheDocument();
  });

  it('crew: never offers a Costs filter/affordance that implies costs exist', () => {
    renderSearch(session({ role: 'crew', isCrew: true, isOwner: false }));
    // The page is read-only and never advertises a cost facet to crew.
    expect(screen.queryByRole('button', { name: /cost/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /cost/i })).not.toBeInTheDocument();
  });

  it('is read-only: renders no form controls beyond the search box', async () => {
    const user = userEvent.setup();
    mockedSearch.mockResolvedValue(OWNER_HITS);
    renderSearch(session({}));
    await user.type(screen.getByRole('searchbox'), 'impeller');
    await screen.findByText('Coastal passage to Heron Cove');
    // Exactly one textbox/searchbox; no other inputs (no create/edit forms).
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
