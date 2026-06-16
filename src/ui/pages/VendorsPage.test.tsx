/**
 * Component test for VendorsPage, driven against a mocked API client
 * (`../lib/api.js`) and a mocked session (`../state/session.js`) — the same way
 * the WelcomePage/Shell tests mock the session and the Trips/Maintenance tests
 * mock the API. We bind to the REAL Vendor shape (name/phone/email/address/url/
 * services[] + a Markdown `body`) — NOT the prototype's mock window.DATA (which
 * had type/note/location).
 *
 * Contracts asserted:
 *   - the directory renders a card per vendor with its contact fields, and
 *     degrades gracefully when an optional field is absent (no blank rows);
 *   - the REVERSE cross-link works: a vendor lists the OPEN maintenance items
 *     referencing its id (computed client-side from GET /api/maintenance), and
 *     clicking one navigates to /maintenance/:id;
 *   - vendors carry NO monetary field, so the page is identical for crew/owner
 *     EXCEPT the write affordances: an OWNER sees Add/Edit/Delete; a CREW sees
 *     none; and in DEMO even the owner-equivalent viewer sees none (writes 403).
 *   - the owner create flow posts via api.createVendor with a compacted payload
 *     (blank optionals omitted) and the owner delete calls api.deleteVendor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import VendorsPage from './VendorsPage.js';
import { api } from '../lib/api.js';
import { useSession, type Session } from '../state/session.js';
import type { VendorRec, MaintenanceRec } from '../lib/types.js';

vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});

vi.mock('../lib/api.js', () => ({
  api: {
    vendors: vi.fn(),
    maintenance: vi.fn(),
    createVendor: vi.fn(),
    updateVendor: vi.fn(),
    deleteVendor: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const mockedUseSession = vi.mocked(useSession);
const mockedVendors = vi.mocked(api.vendors);
const mockedMaint = vi.mocked(api.maintenance);
const mockedCreate = vi.mocked(api.createVendor);
const mockedDelete = vi.mocked(api.deleteVendor);

/* ---- session helper (mirrors WelcomePage.test) ---- */

function session(partial: Partial<Session>): Session {
  return {
    loading: false,
    role: 'guest',
    username: null,
    demo: false,
    ownerConfigured: true,
    isOwner: false,
    isCrew: false,
    isAuthed: true,
    refresh: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    ...partial,
  };
}

const OWNER = session({ role: 'owner', username: 'owner', isOwner: true });
const CREW = session({ role: 'crew', username: 'crew', isCrew: true });
const DEMO = session({ role: 'owner', username: null, demo: true, isOwner: true });

/* ---- fixtures (demo-shaped, real schema) ---- */

const DIESELWORKS: VendorRec = {
  id: 'v-dieselworks',
  name: 'Dieselworks Marine',
  phone: '555-0101',
  email: 'shop@dieselworks.test',
  address: '14 Boatyard Rd, Gull Point',
  url: 'https://dieselworks.test',
  services: ['Engine', 'Raw-water systems'],
  body: 'The folks who know our Universal diesel inside out.',
};

/** A minimal vendor: only the required name + a phone — proves graceful degrade. */
const SAILLOFT: VendorRec = {
  id: 'v-sailloft',
  name: 'Harbor Sail Loft',
  phone: '555-0303',
  body: '',
};

const VENDORS: VendorRec[] = [DIESELWORKS, SAILLOFT];

/** Two maintenance items reference v-dieselworks: one open (overdue), one done.
 *  Only the OPEN one should surface in the vendor's "open jobs" cross-link. */
const MAINT: MaintenanceRec[] = [
  {
    id: 'm-engine-impeller',
    title: 'Replace raw-water impeller',
    system: 'Engine',
    status: 'overdue',
    vendorId: 'v-dieselworks',
    body: '',
  },
  {
    id: 'm-old-belt',
    title: 'Belt replaced last spring',
    system: 'Engine',
    status: 'done',
    vendorId: 'v-dieselworks',
    body: '',
  },
  {
    id: 'm-sail-repair',
    title: 'Restitch mainsail leech',
    system: 'Rig',
    status: 'due',
    vendorId: 'v-sailloft',
    body: '',
  },
];

/* ---- harness ---- */

function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderPage(initialPath = '/vendors'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/vendors" element={<VendorsPage />} />
        <Route path="/vendors/:id" element={<VendorsPage />} />
        {/* sink route so the maintenance cross-link has a destination */}
        <Route path="/maintenance/:id" element={<LocationProbe />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('VendorsPage', () => {
  beforeEach(() => {
    mockedVendors.mockReset();
    mockedMaint.mockReset();
    mockedCreate.mockReset();
    mockedDelete.mockReset();
    mockedUseSession.mockReturnValue(OWNER);
    mockedVendors.mockResolvedValue(VENDORS);
    mockedMaint.mockResolvedValue(MAINT);
  });
  afterEach(() => vi.clearAllMocks());

  it('renders a card per vendor with its contact fields', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Dieselworks Marine')).toBeInTheDocument());

    const card = screen.getByTestId('vendor-v-dieselworks');
    expect(within(card).getByText('555-0101')).toBeInTheDocument();
    expect(within(card).getByText('shop@dieselworks.test')).toBeInTheDocument();
    expect(within(card).getByText('14 Boatyard Rd, Gull Point')).toBeInTheDocument();
    // services rendered as chips
    expect(within(card).getByText('Engine')).toBeInTheDocument();
    expect(within(card).getByText('Raw-water systems')).toBeInTheDocument();
    // the url is a real link
    const link = within(card).getByRole('link', { name: /dieselworks\.test/i }) as HTMLAnchorElement;
    expect(link).toHaveAttribute('href', 'https://dieselworks.test');
  });

  it('degrades gracefully: a vendor missing optional fields shows no blank rows', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Harbor Sail Loft')).toBeInTheDocument());

    const card = screen.getByTestId('vendor-v-sailloft');
    expect(within(card).getByText('555-0303')).toBeInTheDocument();
    // no email/address/url affordances on this card
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(card).queryByText(/@/)).not.toBeInTheDocument();
  });

  it('reverse cross-link: lists ONLY open maintenance jobs for the vendor and navigates', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Dieselworks Marine')).toBeInTheDocument());

    const card = screen.getByTestId('vendor-v-dieselworks');
    // the open job surfaces…
    const job = within(card).getByText('Replace raw-water impeller');
    expect(job).toBeInTheDocument();
    // …the DONE one does not clutter the open-jobs list
    expect(within(card).queryByText('Belt replaced last spring')).not.toBeInTheDocument();

    await userEvent.click(job);
    await waitFor(() =>
      expect(screen.getAllByTestId('location')[0]).toHaveTextContent('/maintenance/m-engine-impeller'),
    );
  });

  it('OWNER sees Add + per-card Edit/Delete affordances', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Dieselworks Marine')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /add vendor/i })).toBeInTheDocument();
    const card = screen.getByTestId('vendor-v-dieselworks');
    expect(within(card).getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('CREW sees the directory but NO write affordances', async () => {
    mockedUseSession.mockReturnValue(CREW);
    renderPage();
    await waitFor(() => expect(screen.getByText('Dieselworks Marine')).toBeInTheDocument());

    // crew can still see the reverse cross-link (no monetary data on vendors)
    const card = screen.getByTestId('vendor-v-dieselworks');
    expect(within(card).getByText('Replace raw-water impeller')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /add vendor/i })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('DEMO (owner-equivalent) hides ALL write affordances (writes 403 in demo)', async () => {
    mockedUseSession.mockReturnValue(DEMO);
    renderPage();
    await waitFor(() => expect(screen.getByText('Dieselworks Marine')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /add vendor/i })).not.toBeInTheDocument();
    const card = screen.getByTestId('vendor-v-dieselworks');
    expect(within(card).queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('owner create: opens the form, posts a compacted payload, then refreshes the list', async () => {
    const created: VendorRec = { id: 'v-rigging-co', name: 'Rigging Co', phone: '555-0909', body: '' };
    mockedCreate.mockResolvedValue(created);
    renderPage();
    await waitFor(() => expect(screen.getByText('Dieselworks Marine')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /add vendor/i }));
    // the form is on screen
    const name = await screen.findByLabelText(/name/i);
    await userEvent.type(name, 'Rigging Co');
    await userEvent.type(screen.getByLabelText(/phone/i), '555-0909');

    // second load happens after a successful create (list refresh)
    mockedVendors.mockResolvedValue([...VENDORS, created]);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    const payload = mockedCreate.mock.calls[0]![0];
    // compacted: name + phone present; no blank optionals leak through as ''
    expect(payload).toMatchObject({ name: 'Rigging Co', phone: '555-0909' });
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('id');
    // and the freshly created vendor shows in the refreshed directory
    await waitFor(() => expect(screen.getByText('Rigging Co')).toBeInTheDocument());
  });

  it('owner delete: confirms then calls api.deleteVendor and drops the card', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockedDelete.mockResolvedValue();
    renderPage();
    await waitFor(() => expect(screen.getByText('Harbor Sail Loft')).toBeInTheDocument());

    const card = screen.getByTestId('vendor-v-sailloft');
    // refreshed list no longer carries the deleted vendor
    mockedVendors.mockResolvedValue([DIESELWORKS]);
    await userEvent.click(within(card).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('v-sailloft'));
    await waitFor(() => expect(screen.queryByText('Harbor Sail Loft')).not.toBeInTheDocument());
    confirmSpy.mockRestore();
  });

  it('?focus= highlights the targeted vendor card', async () => {
    renderPage('/vendors?focus=v-sailloft');
    await waitFor(() => expect(screen.getByText('Harbor Sail Loft')).toBeInTheDocument());
    expect(screen.getByTestId('vendor-v-sailloft')).toHaveClass('is-focused');
  });
});
