/**
 * Component test for InventoryPage, driven against a mocked API client
 * (`../lib/api.js`) + a mocked session (`../state/session.js`) the same way the
 * WelcomePage/Maintenance tests do. We bind to the REAL record shapes (flat
 * frontmatter + a Markdown `body`) — NOT the prototype's richer window.DATA
 * (no required/qty/nested count/inspect.next) — and assert:
 *
 *   - items list from GET /api/inventory, grouped by category;
 *   - the inspect/service/expires task TONE (overdue/due) comes from
 *     GET /api/derived (server-computed against the real clock), NOT a
 *     reimplemented clock — an item with a derived overdue task shows an
 *     "overdue" badge even though its date is in the past;
 *   - photos render as real <img> resolved against the /photos route;
 *   - the Costs cross-link is OWNER-only (hidden for crew/guest);
 *   - OWNER gets create/edit/delete write affordances; crew/guest see a
 *     read-only page (no Add/Edit/Delete); ALL write affordances are hidden
 *     in demo even for the owner-equivalent viewer;
 *   - owner create posts via api.createInventory with a partial-first payload
 *     (blank optionals omitted), and delete calls api.deleteInventory.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import InventoryPage from './InventoryPage.js';
import { useSession, type Session } from '../state/session.js';
import { api } from '../lib/api.js';
import type { InventoryRec, Derived } from '../lib/types.js';

vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});

vi.mock('../lib/api.js', () => ({
  api: {
    inventory: vi.fn(),
    derived: vi.fn(),
    createInventory: vi.fn(),
    updateInventory: vi.fn(),
    deleteInventory: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const mockedUseSession = vi.mocked(useSession);
const mockedInv = vi.mocked(api.inventory);
const mockedDerived = vi.mocked(api.derived);
const mockedCreate = vi.mocked(api.createInventory);
const mockedDelete = vi.mocked(api.deleteInventory);

/* ---- session helper ---- */

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
const OWNER = session({ role: 'owner', isOwner: true, isAuthed: true, username: 'cap' });
const CREW = session({ role: 'crew', isCrew: true, isAuthed: true, username: 'mate' });
const DEMO = session({ role: 'owner', isOwner: true, isAuthed: true, demo: true });

/* ---- fixtures (demo-shaped, real flat schema) ---- */

/** A safety item with an expiry that is in the PAST — the derived view marks it
 *  overdue. (We never recompute the clock here; the tone comes from /api/derived.) */
const FLARES: InventoryRec = {
  id: 'inv-flares',
  name: 'Offshore flare kit',
  category: 'Safety',
  location: 'Cockpit locker, port',
  count: 6,
  condition: 'good',
  expires: '2026-04-01',
  photos: ['photos/inv-flares.jpg'],
  body: 'SOLAS offshore pack. Replace the whole kit on expiry.',
};

/** An item whose next service is coming due (derived "due"). */
const WINCH: InventoryRec = {
  id: 'inv-winch',
  name: 'Primary winch service kit',
  category: 'Rigging',
  location: 'Lazarette',
  service: '2026-07-01',
  body: 'Pawls + springs + grease for the primaries.',
};

/** A soft-good with a level + no dated task (no derived task → "good"/in date). */
const FENDERS: InventoryRec = {
  id: 'inv-fenders',
  name: 'Fenders',
  category: 'Deck',
  location: 'Lazarette',
  count: 4,
  level: 'ok',
  condition: 'fair',
  body: '',
};

const DERIVED: Derived = {
  attention: 2,
  inventoryTasks: [
    { invId: 'inv-flares', kind: 'expires', date: '2026-04-01', status: 'overdue' },
    { invId: 'inv-winch', kind: 'service', date: '2026-07-01', status: 'due' },
  ],
};
const EMPTY_DERIVED: Derived = { attention: 0, inventoryTasks: [] };

/* ---- harness ---- */

function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderPage(s: Session, initialPath = '/inventory'): void {
  mockedUseSession.mockReturnValue(s);
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/:id" element={<InventoryPage />} />
        {/* sink routes so a cross-link has a destination */}
        <Route path="/costs" element={<LocationProbe />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('InventoryPage', () => {
  beforeEach(() => {
    mockedUseSession.mockReset();
    mockedInv.mockReset();
    mockedDerived.mockReset();
    mockedCreate.mockReset();
    mockedDelete.mockReset();
    mockedInv.mockResolvedValue([FLARES, WINCH, FENDERS]);
    mockedDerived.mockResolvedValue(DERIVED);
  });
  afterEach(() => vi.clearAllMocks());

  it('lists inventory items from GET /api/inventory, grouped by category', async () => {
    renderPage(OWNER);
    await waitFor(() => expect(screen.getByText('Offshore flare kit')).toBeInTheDocument());
    expect(screen.getByText('Primary winch service kit')).toBeInTheDocument();
    expect(screen.getByText('Fenders')).toBeInTheDocument();
    // Category section headings present.
    expect(screen.getByText('Safety')).toBeInTheDocument();
    expect(screen.getByText('Rigging')).toBeInTheDocument();
  });

  it('shows the derived task TONE from /api/derived (overdue/due), not a reimplemented clock', async () => {
    renderPage(OWNER);
    await waitFor(() => expect(screen.getByText('Offshore flare kit')).toBeInTheDocument());

    // The flares row carries the derived "overdue" tone (its expiry is past).
    const flaresRow = screen.getByTestId('inv-row-inv-flares');
    expect(within(flaresRow).getByText(/overdue/i)).toBeInTheDocument();
    // The winch row carries the derived "due" tone.
    const winchRow = screen.getByTestId('inv-row-inv-winch');
    expect(within(winchRow).getByText(/due/i)).toBeInTheDocument();
  });

  it('rollup stats reflect the derived attention/coming counts', async () => {
    renderPage(OWNER);
    await waitFor(() => expect(screen.getByText('Offshore flare kit')).toBeInTheDocument());
    expect(screen.getByTestId('rollup-attention')).toHaveTextContent('1');
    expect(screen.getByTestId('rollup-coming')).toHaveTextContent('1');
  });

  it('renders an item photo via the /photos route', async () => {
    renderPage(OWNER, '/inventory/inv-flares');
    await waitFor(() => expect(screen.getByTestId('inv-detail')).toBeInTheDocument());
    const img = screen.getByRole('img', { name: /flare|photo/i }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/photos/inv-flares.jpg');
  });

  it('OWNER sees the Costs cross-link on the detail; it navigates to /costs?focus=', async () => {
    renderPage(OWNER, '/inventory/inv-flares');
    await waitFor(() => expect(screen.getByTestId('inv-detail')).toBeInTheDocument());
    const link = screen.getByTestId('cost-link');
    expect(link).toBeInTheDocument();
    await userEvent.click(link);
    await waitFor(() =>
      expect(screen.getAllByTestId('location')[0]).toHaveTextContent('/costs?focus=inv-flares'),
    );
  });

  it('CREW never sees a Costs cross-link (cost link is owner-only)', async () => {
    renderPage(CREW, '/inventory/inv-flares');
    await waitFor(() => expect(screen.getByTestId('inv-detail')).toBeInTheDocument());
    expect(screen.queryByTestId('cost-link')).not.toBeInTheDocument();
    // and no money / cost text leaks anywhere on the page.
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('OWNER gets write affordances: Add item + per-item Edit/Delete', async () => {
    renderPage(OWNER);
    await waitFor(() => expect(screen.getByText('Offshore flare kit')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument();
  });

  it('CREW sees a read-only page: no Add item, no Edit/Delete affordances', async () => {
    renderPage(CREW);
    await waitFor(() => expect(screen.getByText('Offshore flare kit')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /add item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('DEMO hides all write affordances even for the owner-equivalent viewer', async () => {
    renderPage(DEMO);
    await waitFor(() => expect(screen.getByText('Offshore flare kit')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /add item/i })).not.toBeInTheDocument();
  });

  it('OWNER create: posts a partial-first payload (blank optionals omitted) via api.createInventory', async () => {
    mockedCreate.mockResolvedValue({ ...FENDERS, id: 'inv-new', name: 'Spare bilge pump' });
    renderPage(OWNER);
    await waitFor(() => expect(screen.getByText('Offshore flare kit')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /add item/i }));
    // Fill only the required name + a category; leave the rest blank.
    const nameInput = await screen.findByLabelText(/name/i);
    await userEvent.type(nameInput, 'Spare bilge pump');
    await userEvent.type(screen.getByLabelText(/category/i), 'Spares');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    const payload = mockedCreate.mock.calls[0]![0];
    expect(payload).toMatchObject({ name: 'Spare bilge pump', category: 'Spares' });
    // Blank optionals are OMITTED — never sent as ''.
    expect(payload).not.toHaveProperty('location');
    expect(payload).not.toHaveProperty('level');
    expect(payload).not.toHaveProperty('id');
  });

  it('OWNER delete: calls api.deleteInventory with the item id', async () => {
    mockedDelete.mockResolvedValue(undefined);
    renderPage(OWNER, '/inventory/inv-fenders');
    await waitFor(() => expect(screen.getByTestId('inv-detail')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    // Confirm in the dialog.
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('inv-fenders'));
  });

  it('degrades gracefully when there are no items', async () => {
    mockedInv.mockResolvedValue([]);
    mockedDerived.mockResolvedValue(EMPTY_DERIVED);
    renderPage(OWNER);
    await waitFor(() => expect(screen.getByText(/nothing aboard yet|no items/i)).toBeInTheDocument());
  });

  it('opens an item detail on row click with its facts + body', async () => {
    renderPage(OWNER);
    await waitFor(() => expect(screen.getByText('Offshore flare kit')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Offshore flare kit'));
    await waitFor(() => expect(screen.getByTestId('inv-detail')).toBeInTheDocument());
    // Facts + narrative body.
    expect(screen.getByText('Cockpit locker, port')).toBeInTheDocument();
    expect(screen.getByText(/SOLAS offshore pack/i)).toBeInTheDocument();
  });
});
