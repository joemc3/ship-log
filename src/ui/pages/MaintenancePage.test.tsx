/**
 * Component test for MaintenancePage, driven against a mocked API client
 * (`../lib/api.js`) and a mocked session (`../state/session.js`) the same way the
 * foundation's WelcomePage/session tests do. We bind to the REAL record shapes
 * (frontmatter + body) — NOT the prototype's richer window.DATA — and assert two
 * contracts:
 *
 *   1. COST REDACTION DEGRADES GRACEFULLY:
 *      - an OWNER fixture (costEst present) renders the cost row + Est. outstanding
 *        stat + the cost cross-link;
 *      - a CREW fixture (costEst stripped server-side, so absent) renders NO cost
 *        row, NO cost link, and a clean (cost-free) outstanding stat.
 *
 *   2. ROLE-CORRECT WRITE AFFORDANCES (P1d Milestone B):
 *      - CREW + OWNER (not demo): a real "Mark complete" control on each non-done
 *        item → POST /api/maintenance/:id/complete, then refresh; it NEVER exposes
 *        or touches costEst.
 *      - OWNER ONLY: full create/edit (incl. costEst input, vendor + source-trip
 *        pickers) + delete. CREW sees NONE of those (the API 403s them anyway).
 *      - DEMO: every write affordance is hidden (writes are denyInDemo → 403).
 *
 * We also assert the overdue/due rollup, the body-steps checklist, the photo
 * <img> (resolved against the /photos route), and that cross-links navigate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import MaintenancePage from './MaintenancePage.js';
import { api } from '../lib/api.js';
import { useSession, type Session } from '../state/session.js';
import type { MaintenanceRec, VendorRec, TripRec, Derived } from '../lib/types.js';

vi.mock('../lib/api.js', () => ({
  api: {
    maintenance: vi.fn(),
    vendors: vi.fn(),
    derived: vi.fn(),
    trips: vi.fn(),
    completeMaintenance: vi.fn(),
    createMaintenance: vi.fn(),
    updateMaintenance: vi.fn(),
    deleteMaintenance: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

// The page learns its role/demo from the session context (to gate write
// affordances). Mock it the same way the Shell/Welcome tests do.
vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});

const mockedMaint = vi.mocked(api.maintenance);
const mockedVendors = vi.mocked(api.vendors);
const mockedDerived = vi.mocked(api.derived);
const mockedTrips = vi.mocked(api.trips);
const mockedComplete = vi.mocked(api.completeMaintenance);
const mockedCreate = vi.mocked(api.createMaintenance);
const mockedUpdate = vi.mocked(api.updateMaintenance);
const mockedDelete = vi.mocked(api.deleteMaintenance);
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

const OWNER = session({ role: 'owner', isOwner: true, isAuthed: true, username: 'skipper' });
const CREW = session({ role: 'crew', isCrew: true, isAuthed: true, username: 'mate' });
const DEMO = session({ role: 'owner', isOwner: true, isAuthed: true, demo: true });

/* ---- fixtures (demo-shaped, real schema) ---- */

const IMPELLER_BODY = `The engine overheated under sustained power on the delivery.

## Steps
- [x] Confirm weak raw-water flow.
- [ ] Fit new impeller + cover gasket.
- [ ] Run up and verify temp + flow.
`;

/** Owner view: costEst present, with a vendor + source-trip cross-link + photo. */
const IMPELLER_OWNER: MaintenanceRec = {
  id: 'm-engine-impeller',
  title: 'Replace raw-water impeller (overheating)',
  system: 'Engine',
  status: 'overdue',
  priority: 1,
  opened: '2026-05-09',
  due: '2026-05-20',
  completed: null,
  costEst: 180,
  vendorId: 'v-dieselworks',
  fromTripId: 't-2026-05-09',
  photos: ['photos/m-engine-impeller.jpg'],
  body: IMPELLER_BODY,
};

/** Crew view of the SAME record: costEst (and vendor cost-link) stripped server-side. */
const IMPELLER_CREW: MaintenanceRec = { ...IMPELLER_OWNER, costEst: undefined };

const BOTTOM_PAINT: MaintenanceRec = {
  id: 'm-bottom-paint',
  title: 'Haul out and bottom paint',
  system: 'Hull',
  status: 'scheduled',
  priority: 2,
  opened: '2026-06-01',
  due: '2026-09-20',
  completed: null,
  costEst: 850,
  vendorId: 'v-yard',
  body: 'The annual haulout.\n\n## Steps\n- [ ] Confirm yard slot.\n',
};

const VHF_DONE: MaintenanceRec = {
  id: 'm-vhf-antenna',
  title: 'Re-seat VHF antenna connector',
  system: 'Electronics',
  status: 'done',
  opened: '2026-03-01',
  due: '2026-03-15',
  completed: '2026-03-12',
  body: 'Cleaned and re-seated the masthead connector.',
};

const VENDORS: VendorRec[] = [
  { id: 'v-dieselworks', name: 'Dieselworks Marine', phone: '555-0101', services: ['Engine'], body: '' },
  { id: 'v-yard', name: 'Harbor Boatyard', phone: '555-0202', body: '' },
];

const TRIPS: TripRec[] = [
  { id: 't-2026-05-09', title: 'Coastal passage to Heron Cove', date: '2026-05-09', body: '' },
  { id: 't-2026-04-18', title: 'Spring shakedown', date: '2026-04-18', body: '' },
];

const DERIVED: Derived = {
  attention: 3,
  inventoryTasks: [
    { invId: 'inv-flares', kind: 'expires', date: '2026-04-01', status: 'overdue' },
  ],
};

const EMPTY_DERIVED: Derived = { attention: 0, inventoryTasks: [] };

/* ---- harness ---- */

function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderPage(initialPath = '/maintenance'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/maintenance" element={<MaintenancePage />} />
        <Route path="/maintenance/:id" element={<MaintenancePage />} />
        {/* sink routes so cross-link navigation has a destination */}
        <Route path="/trips" element={<LocationProbe />} />
        <Route path="/vendors" element={<LocationProbe />} />
        <Route path="/costs" element={<LocationProbe />} />
        <Route path="/inventory" element={<LocationProbe />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('MaintenancePage', () => {
  beforeEach(() => {
    mockedMaint.mockReset();
    mockedVendors.mockReset();
    mockedDerived.mockReset();
    mockedTrips.mockReset();
    mockedComplete.mockReset();
    mockedCreate.mockReset();
    mockedUpdate.mockReset();
    mockedDelete.mockReset();
    mockedUseSession.mockReset();
    mockedVendors.mockResolvedValue(VENDORS);
    mockedTrips.mockResolvedValue(TRIPS);
    // Default: owner, not demo. Individual tests override.
    mockedUseSession.mockReturnValue(OWNER);
  });
  afterEach(() => vi.clearAllMocks());

  it('renders the work list with status pills + the overdue/due rollup', async () => {
    mockedMaint.mockResolvedValue([IMPELLER_OWNER, BOTTOM_PAINT, VHF_DONE]);
    mockedDerived.mockResolvedValue(DERIVED);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Replace raw-water impeller (overheating)')).toBeInTheDocument(),
    );
    // Active items appear in the queue; the done one does NOT clutter the queue.
    expect(screen.getByText('Haul out and bottom paint')).toBeInTheDocument();

    // Rollup stats: 1 overdue (impeller) + 1 inventory-overdue task surfaced from
    // /api/derived = 2 overdue; 0 due; 1 scheduled.
    const overdue = screen.getByTestId('rollup-overdue');
    expect(overdue).toHaveTextContent('2');
    const scheduled = screen.getByTestId('rollup-scheduled');
    expect(scheduled).toHaveTextContent('1');
  });

  it('OWNER fixture: shows the est. cost in detail + the Est. outstanding stat', async () => {
    mockedMaint.mockResolvedValue([IMPELLER_OWNER, BOTTOM_PAINT]);
    mockedDerived.mockResolvedValue(EMPTY_DERIVED);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('rollup-est')).toBeInTheDocument());
    // 180 + 850 outstanding, formatted with a $.
    expect(screen.getByTestId('rollup-est')).toHaveTextContent('$1,030');

    // open the detail
    await userEvent.click(screen.getByText('Replace raw-water impeller (overheating)'));
    await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());

    const costRow = screen.getByTestId('detail-cost');
    expect(costRow).toHaveTextContent('$180.00');
    // owner gets the cost cross-link affordance
    expect(screen.getByTestId('cost-link')).toBeInTheDocument();
  });

  it('CREW fixture (costEst absent): renders NO cost row, NO cost link, no cost stat', async () => {
    mockedUseSession.mockReturnValue(CREW);
    mockedMaint.mockResolvedValue([IMPELLER_CREW]);
    mockedDerived.mockResolvedValue(EMPTY_DERIVED);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Replace raw-water impeller (overheating)')).toBeInTheDocument(),
    );
    // No "Est. outstanding" rollup stat at all when nothing carries a cost.
    expect(screen.queryByTestId('rollup-est')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Replace raw-water impeller (overheating)'));
    await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());

    // The cost detail row + the cost cross-link are entirely absent for crew.
    expect(screen.queryByTestId('detail-cost')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cost-link')).not.toBeInTheDocument();
    // and we never print "$NaN" or a bare "$".
    expect(screen.queryByText(/\$NaN/)).not.toBeInTheDocument();
  });

  it('detail shows the body-steps checklist + a photo <img> resolved to /photos', async () => {
    mockedMaint.mockResolvedValue([IMPELLER_OWNER]);
    mockedDerived.mockResolvedValue(EMPTY_DERIVED);
    renderPage('/maintenance/m-engine-impeller');

    await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());
    // checklist steps parsed out of the body markdown
    expect(screen.getByText('Confirm weak raw-water flow.')).toBeInTheDocument();
    expect(screen.getByText('Fit new impeller + cover gasket.')).toBeInTheDocument();
    // photo rendered as a real <img> pointing at the photo route
    const img = screen.getByRole('img', { name: /impeller|photo/i }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/photos/m-engine-impeller.jpg');
  });

  it('cross-links: fromTripId navigates to /trips?focus=, vendorId to /vendors?focus=', async () => {
    mockedMaint.mockResolvedValue([IMPELLER_OWNER]);
    mockedDerived.mockResolvedValue(EMPTY_DERIVED);
    renderPage('/maintenance/m-engine-impeller');

    await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('trip-link'));
    await waitFor(() =>
      expect(screen.getAllByTestId('location')[0]).toHaveTextContent('/trips?focus=t-2026-05-09'),
    );
  });

  it('vendor cross-link navigates to /vendors?focus=', async () => {
    mockedMaint.mockResolvedValue([IMPELLER_OWNER]);
    mockedDerived.mockResolvedValue(EMPTY_DERIVED);
    renderPage('/maintenance/m-engine-impeller');

    await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('vendor-link'));
    await waitFor(() =>
      expect(screen.getAllByTestId('location')[0]).toHaveTextContent('/vendors?focus=v-dieselworks'),
    );
  });

  it('queue inventory task (from /api/derived) cross-links to /inventory?focus=', async () => {
    mockedMaint.mockResolvedValue([]);
    mockedDerived.mockResolvedValue(DERIVED);
    renderPage();

    await waitFor(() => expect(screen.getByText(/inv-flares/i)).toBeInTheDocument());
    await userEvent.click(within(screen.getByTestId('queue-inv-flares')).getByRole('button'));
    await waitFor(() =>
      expect(screen.getAllByTestId('location')[0]).toHaveTextContent('/inventory?focus=inv-flares'),
    );
  });

  /* ============================================================ write affordances */

  describe('write: mark complete (crew + owner)', () => {
    it('CREW: a "Mark complete" control posts complete + refreshes, never touching costEst', async () => {
      mockedUseSession.mockReturnValue(CREW);
      mockedMaint.mockResolvedValue([IMPELLER_CREW]);
      mockedDerived.mockResolvedValue(EMPTY_DERIVED);
      mockedComplete.mockResolvedValue({ ...IMPELLER_CREW, status: 'done', completed: '2026-06-16' });
      renderPage('/maintenance/m-engine-impeller');

      await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());

      // The control is real (enabled), not the old disabled placeholder.
      const btn = screen.getByRole('button', { name: /mark complete/i });
      expect(btn).toBeEnabled();
      await userEvent.click(btn);

      // Optional completed-date + note inputs appear; defaulting the date is fine.
      const confirm = await screen.findByRole('button', { name: /confirm|complete|done/i });
      await userEvent.click(confirm);

      await waitFor(() => expect(mockedComplete).toHaveBeenCalledTimes(1));
      const [id, opts] = mockedComplete.mock.calls[0]!;
      expect(id).toBe('m-engine-impeller');
      // The complete op NEVER carries a cost field.
      expect(opts ?? {}).not.toHaveProperty('costEst');
      // Data is re-fetched on success (the initial load already called it once).
      await waitFor(() => expect(mockedMaint.mock.calls.length).toBeGreaterThanOrEqual(2));
    });

    it('CREW: does NOT see a delete control, a costEst input, or full-edit', async () => {
      mockedUseSession.mockReturnValue(CREW);
      mockedMaint.mockResolvedValue([IMPELLER_CREW]);
      mockedDerived.mockResolvedValue(EMPTY_DERIVED);
      renderPage('/maintenance/m-engine-impeller');

      await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());

      // No owner-only affordances for crew.
      expect(screen.queryByRole('button', { name: /delete item/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /edit item/i })).not.toBeInTheDocument();
      // Opening "Mark complete" must NOT surface a cost input.
      await userEvent.click(screen.getByRole('button', { name: /mark complete/i }));
      expect(screen.queryByLabelText(/cost/i)).not.toBeInTheDocument();
    });

    it('owner sees Mark complete too (it is crew + owner)', async () => {
      mockedUseSession.mockReturnValue(OWNER);
      mockedMaint.mockResolvedValue([IMPELLER_OWNER]);
      mockedDerived.mockResolvedValue(EMPTY_DERIVED);
      renderPage('/maintenance/m-engine-impeller');

      await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /mark complete/i })).toBeEnabled();
    });
  });

  describe('write: owner-only create / edit / delete', () => {
    it('OWNER: "Add item" opens a create form with a costEst input + vendor/trip pickers', async () => {
      mockedUseSession.mockReturnValue(OWNER);
      mockedMaint.mockResolvedValue([IMPELLER_OWNER]);
      mockedDerived.mockResolvedValue(EMPTY_DERIVED);
      mockedCreate.mockResolvedValue({
        id: 'm-new', title: 'New job', status: 'scheduled', body: '',
      });
      renderPage();

      await waitFor(() => expect(screen.getByText('Replace raw-water impeller (overheating)')).toBeInTheDocument());

      // The "Add item" button is now enabled (real op), not the disabled placeholder.
      const add = screen.getByRole('button', { name: /add item/i });
      expect(add).toBeEnabled();
      await userEvent.click(add);

      // Owner create form exposes the cost input + the vendor/source-trip pickers.
      expect(await screen.findByLabelText(/title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/cost/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/vendor/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/trip/i)).toBeInTheDocument();

      // Fill the required title + create.
      await userEvent.type(screen.getByLabelText(/title/i), 'Replace bilge pump');
      await userEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
      const payload = mockedCreate.mock.calls[0]![0] as Record<string, unknown>;
      expect(payload.title).toBe('Replace bilge pump');
      // Status defaults to a valid enum; no id is ever sent (server derives it).
      expect(payload).not.toHaveProperty('id');
      // Refresh after success.
      await waitFor(() => expect(mockedMaint.mock.calls.length).toBeGreaterThanOrEqual(2));
    });

    it('OWNER: an item detail offers Edit (prefilled costEst) and Delete', async () => {
      mockedUseSession.mockReturnValue(OWNER);
      mockedMaint.mockResolvedValue([IMPELLER_OWNER]);
      mockedDerived.mockResolvedValue(EMPTY_DERIVED);
      mockedUpdate.mockResolvedValue({ ...IMPELLER_OWNER, title: 'Replace raw-water impeller' });
      renderPage('/maintenance/m-engine-impeller');

      await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button', { name: /edit item/i }));

      // The cost input is prefilled from the record's costEst.
      const cost = await screen.findByLabelText(/cost/i) as HTMLInputElement;
      expect(cost.value).toBe('180');

      await userEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
      expect(mockedUpdate.mock.calls[0]![0]).toBe('m-engine-impeller');
    });

    it('OWNER: Delete confirms then calls deleteMaintenance + navigates back to the list', async () => {
      mockedUseSession.mockReturnValue(OWNER);
      mockedMaint.mockResolvedValue([IMPELLER_OWNER]);
      mockedDerived.mockResolvedValue(EMPTY_DERIVED);
      mockedDelete.mockResolvedValue(undefined);
      renderPage('/maintenance/m-engine-impeller');

      await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button', { name: /delete/i }));
      // A confirm step guards the destructive op.
      const confirm = await screen.findByRole('button', { name: /confirm|yes|delete/i });
      await userEvent.click(confirm);

      await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('m-engine-impeller'));
    });
  });

  describe('write: demo lockout', () => {
    it('DEMO (owner-equivalent, read-only): hides Add item, Mark complete, Edit, Delete', async () => {
      mockedUseSession.mockReturnValue(DEMO);
      mockedMaint.mockResolvedValue([IMPELLER_OWNER]);
      mockedDerived.mockResolvedValue(EMPTY_DERIVED);
      renderPage('/maintenance/m-engine-impeller');

      await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());

      // Every write affordance is hidden in demo (writes are denyInDemo → 403).
      expect(screen.queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /edit item/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /delete item/i })).not.toBeInTheDocument();

      // And on the list view, no "Add item".
      renderPage();
      await waitFor(() => expect(screen.getAllByText('Replace raw-water impeller (overheating)').length).toBeGreaterThan(0));
      expect(screen.queryByRole('button', { name: /add item/i })).not.toBeInTheDocument();
    });
  });
});
