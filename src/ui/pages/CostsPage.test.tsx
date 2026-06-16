/**
 * Component test for CostsPage — the OWNER-ONLY ledger. Driven against a mocked
 * API client (`../lib/api.js`) and a mocked session (`../state/session.js`) the
 * same way WelcomePage/MaintenancePage do. We bind to the REAL Cost shape
 * (frontmatter: date/category/item/amount/vendorId/maintId) and assert:
 *   - the donut TOTAL + per-category rollup + ledger rows render from /api/costs;
 *   - category-chip filtering narrows the ledger + subtotal;
 *   - cross-links go to /vendors?focus= and /maintenance?focus=;
 *   - OWNER (not demo) sees create/edit/delete affordances; create posts via
 *     api.createCost with amount coerced to a number and blank optionals omitted;
 *   - DEMO owner-equivalent viewer sees NO write affordances (denyInDemo);
 *   - a crew/guest who somehow reaches the page (API 403s) gets a graceful empty
 *     state, never a blank screen or a thrown error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import CostsPage from './CostsPage.js';
import { useSession, type Session } from '../state/session.js';
import { api, ApiError } from '../lib/api.js';
import type { CostRec, VendorRec } from '../lib/types.js';

vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});

vi.mock('../lib/api.js', () => ({
  api: {
    costs: vi.fn(),
    vendors: vi.fn(),
    createCost: vi.fn(),
    updateCost: vi.fn(),
    deleteCost: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
    get isForbidden(): boolean {
      return this.status === 403;
    }
  },
}));

const mockedUseSession = vi.mocked(useSession);
const mockedCosts = vi.mocked(api.costs);
const mockedVendors = vi.mocked(api.vendors);
const mockedCreate = vi.mocked(api.createCost);
const mockedUpdate = vi.mocked(api.updateCost);
const mockedDelete = vi.mocked(api.deleteCost);

/* ---- session helper (mirrors WelcomePage.test) ---- */
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

/* ---- fixtures (demo-shaped, real Cost schema) ---- */

const IMPELLER: CostRec = {
  id: 'c-impeller-2026-05-21',
  date: '2026-05-21',
  category: 'Part replacement',
  item: 'Raw-water impeller + cover gasket',
  amount: 182.4,
  vendorId: 'v-dieselworks',
  maintId: 'm-engine-impeller',
  body: '',
};

const SLIP: CostRec = {
  id: 'c-slip-2026-06-01',
  date: '2026-06-01',
  category: 'Slip & mooring',
  item: 'June slip fee',
  amount: 420,
  body: '',
};

const VARNISH: CostRec = {
  id: 'c-varnish-2026-04-10',
  date: '2026-04-10',
  category: 'Consumable',
  item: 'Spar varnish (1 qt)',
  amount: 38.5,
  body: '',
};

const COSTS: CostRec[] = [IMPELLER, SLIP, VARNISH];

const VENDORS: VendorRec[] = [
  { id: 'v-dieselworks', name: 'Dieselworks Marine', phone: '555-0101', services: ['Engine'], body: '' },
];

/* ---- harness ---- */

function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderPage(s: Session = session({}), initialPath = '/costs'): void {
  mockedUseSession.mockReturnValue(s);
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/costs" element={<CostsPage />} />
        <Route path="/costs/:id" element={<CostsPage />} />
        {/* sink routes so cross-link navigation has a destination */}
        <Route path="/vendors" element={<LocationProbe />} />
        <Route path="/maintenance" element={<LocationProbe />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('CostsPage', () => {
  beforeEach(() => {
    mockedUseSession.mockReset();
    mockedCosts.mockReset();
    mockedVendors.mockReset();
    mockedCreate.mockReset();
    mockedUpdate.mockReset();
    mockedDelete.mockReset();
    mockedVendors.mockResolvedValue(VENDORS);
    mockedCosts.mockResolvedValue(COSTS);
  });
  afterEach(() => vi.clearAllMocks());

  it('renders the ledger rows + the TOTAL from /api/costs', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('June slip fee')).toBeInTheDocument());
    expect(screen.getByText('Raw-water impeller + cover gasket')).toBeInTheDocument();
    expect(screen.getByText('Spar varnish (1 qt)')).toBeInTheDocument();
    // Total = 182.4 + 420 + 38.5 = 640.90, shown with a $.
    expect(screen.getByTestId('costs-total')).toHaveTextContent('$640.90');
  });

  it('rolls up spend per category (a bar/row per category that has spend)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('June slip fee')).toBeInTheDocument());
    const rollup = screen.getByTestId('category-rollup');
    expect(within(rollup).getByText('Part replacement')).toBeInTheDocument();
    expect(within(rollup).getByText('Slip & mooring')).toBeInTheDocument();
    expect(within(rollup).getByText('Consumable')).toBeInTheDocument();
  });

  it('filters the ledger + subtotal by category chip', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('June slip fee')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^Slip & mooring$/ }));
    // Only the slip cost stays in the ledger.
    expect(screen.getByText('June slip fee')).toBeInTheDocument();
    expect(screen.queryByText('Raw-water impeller + cover gasket')).not.toBeInTheDocument();
    // Subtotal reflects just the filtered rows.
    expect(screen.getByTestId('costs-total')).toHaveTextContent('$420.00');
  });

  it('cross-links a cost to its vendor (/vendors?focus=) and maintenance (/maintenance?focus=)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Raw-water impeller + cover gasket')).toBeInTheDocument());

    await user.click(screen.getByTestId('vendor-link-c-impeller-2026-05-21'));
    await waitFor(() =>
      expect(screen.getAllByTestId('location')[0]).toHaveTextContent('/vendors?focus=v-dieselworks'),
    );
  });

  it('cross-links a cost to its maintenance item', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Raw-water impeller + cover gasket')).toBeInTheDocument());

    await user.click(screen.getByTestId('maint-link-c-impeller-2026-05-21'));
    await waitFor(() =>
      expect(screen.getAllByTestId('location')[0]).toHaveTextContent('/maintenance?focus=m-engine-impeller'),
    );
  });

  it('OWNER (not demo): exposes a "Log a cost" affordance + per-row edit/delete', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('June slip fee')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /log a cost/i })).toBeInTheDocument();
    expect(screen.getByTestId('edit-c-slip-2026-06-01')).toBeInTheDocument();
    expect(screen.getByTestId('delete-c-slip-2026-06-01')).toBeInTheDocument();
  });

  it('create: posts via api.createCost with amount coerced to a number + blanks omitted', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue({
      id: 'c-new-fuel-2026-06-12',
      date: '2026-06-12',
      item: 'Diesel top-up',
      amount: 60,
      body: '',
    } as CostRec);
    renderPage();
    await waitFor(() => expect(screen.getByText('June slip fee')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /log a cost/i }));
    // Fill the required fields (date, item, amount); leave category/vendor blank.
    await user.type(screen.getByLabelText(/^Date/i), '2026-06-12');
    await user.type(screen.getByLabelText(/^Item/i), 'Diesel top-up');
    await user.type(screen.getByLabelText(/^Amount/i), '60');
    await user.click(screen.getByRole('button', { name: /^Save$|log a cost/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    const payload = mockedCreate.mock.calls[0]![0];
    expect(payload).toMatchObject({ date: '2026-06-12', item: 'Diesel top-up', amount: 60 });
    // amount is a real number, not the string "60".
    expect(typeof (payload as { amount: unknown }).amount).toBe('number');
    // blank optionals are omitted (never sent as '').
    expect('category' in payload).toBe(false);
    expect('vendorId' in payload).toBe(false);
  });

  it('edit: pre-fills the form and PUTs via api.updateCost', async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue({ ...SLIP, amount: 430 } as CostRec);
    renderPage();
    await waitFor(() => expect(screen.getByText('June slip fee')).toBeInTheDocument());

    await user.click(screen.getByTestId('edit-c-slip-2026-06-01'));
    // The existing item value is pre-filled.
    const itemInput = screen.getByLabelText(/^Item/i) as HTMLInputElement;
    await waitFor(() => expect(itemInput.value).toBe('June slip fee'));
    // The save button's accessible name includes the leading check icon ("check Save").
    await user.click(screen.getByRole('button', { name: /\bSave\b/i }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate.mock.calls[0]![0]).toBe('c-slip-2026-06-01');
  });

  it('delete: calls api.deleteCost for the row after confirmation', async () => {
    const user = userEvent.setup();
    mockedDelete.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await waitFor(() => expect(screen.getByText('June slip fee')).toBeInTheDocument());

    await user.click(screen.getByTestId('delete-c-slip-2026-06-01'));
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('c-slip-2026-06-01'));
    confirmSpy.mockRestore();
  });

  it('DEMO owner-equivalent: hides ALL write affordances (denyInDemo)', async () => {
    renderPage(session({ demo: true }));
    await waitFor(() => expect(screen.getByText('June slip fee')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /log a cost/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-c-slip-2026-06-01')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delete-c-slip-2026-06-01')).not.toBeInTheDocument();
  });

  it('CREW/guest who reaches the page (API 403s): graceful empty, never a blank/throw', async () => {
    mockedCosts.mockRejectedValue(new ApiError(403, 'forbidden'));
    renderPage(session({ role: 'crew', isOwner: false, isCrew: true }));
    // No crash; an explanatory empty-state, not a white screen.
    await waitFor(() => expect(screen.getByTestId('costs-forbidden')).toBeInTheDocument());
    // And absolutely no money / write affordance leaks.
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /log a cost/i })).not.toBeInTheDocument();
  });

  it('empty ledger: shows an empty state, no $NaN', async () => {
    mockedCosts.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('costs-empty')).toBeInTheDocument());
    expect(screen.queryByText(/\$NaN/)).not.toBeInTheDocument();
  });
});
