/**
 * Component test for MaintenancePage, driven against a mocked API client
 * (`../lib/api.js`) the same way the foundation's session test mocks it. We bind
 * to the REAL record shapes (frontmatter + body) — NOT the prototype's richer
 * window.DATA — and assert the cost-redaction degradation contract:
 *   - an OWNER fixture (costEst present) renders the cost row + Est. outstanding
 *     stat + the cost cross-link;
 *   - a CREW fixture (costEst stripped server-side, so absent) renders NO cost
 *     row, NO cost link, and a clean (cost-free) outstanding stat.
 * We also assert the overdue/due rollup, the body-steps checklist, the photo
 * <img> (resolved against the /photos route), and that cross-links navigate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import MaintenancePage from './MaintenancePage.js';
import { api } from '../lib/api.js';
import type { MaintenanceRec, VendorRec, Derived } from '../lib/types.js';

vi.mock('../lib/api.js', () => ({
  api: {
    maintenance: vi.fn(),
    vendors: vi.fn(),
    derived: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const mockedMaint = vi.mocked(api.maintenance);
const mockedVendors = vi.mocked(api.vendors);
const mockedDerived = vi.mocked(api.derived);

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
    mockedVendors.mockResolvedValue(VENDORS);
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

  it('leaves a disabled "Mark complete" placeholder on an open item (wired later)', async () => {
    mockedMaint.mockResolvedValue([IMPELLER_OWNER]);
    mockedDerived.mockResolvedValue(EMPTY_DERIVED);
    renderPage('/maintenance/m-engine-impeller');

    await waitFor(() => expect(screen.getByTestId('maint-detail')).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: /mark complete/i });
    expect(btn).toBeDisabled();
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
});
