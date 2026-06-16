/**
 * Component test for ManualsPage, driven against a mocked API client
 * (`../lib/api.js`) and a mocked session (`../state/session.js`) the same way the
 * Welcome/Maintenance tests do. We bind to the REAL record shapes — the
 * authoritative Manual is { id, title, kind?, file?, sections?[{title,anchor?}] }
 * plus a Markdown `body` (NOT the prototype's mock pages/year/summary/steps[]).
 *
 * The contracts asserted here:
 *   - the manuals render as cards (kind badge + title), with the sections[] TOC
 *     and the body note revealed when a card is expanded;
 *   - a manual WITH a `file` exposes a "Download" link to the /files/manuals
 *     route (api.manualFileUrl); one WITHOUT a file shows no such link;
 *   - quick-reference cards render title + body;
 *   - WRITES: the owner sees create/edit/delete affordances; a CREW viewer sees
 *     NONE; an OWNER in DEMO sees NONE (every write carries denyInDemo);
 *   - manuals carry NO monetary data, so nothing here ever renders a cost field
 *     or offers a cost input — a redaction-graceful guarantee we assert directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ManualsPage from './ManualsPage.js';
import { useSession, type Session } from '../state/session.js';
import { api } from '../lib/api.js';
import type { ManualRec, Quickref } from '../lib/types.js';

vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});

vi.mock('../lib/api.js', () => ({
  api: {
    manuals: vi.fn(),
    quickref: vi.fn(),
    manualFileUrl: (file: string): string => {
      const name = file.replace(/^\/+/, '').replace(/^manuals\//, '');
      return `/files/manuals/${encodeURIComponent(name)}`;
    },
    createManual: vi.fn(),
    updateManual: vi.fn(),
    deleteManual: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
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

/* ---- fixtures (demo-shaped, real schema) ---- */

const ENGINE: ManualRec = {
  id: 'man-engine',
  title: "Universal M-25 Owner's Manual",
  kind: 'engine',
  file: 'manuals/universal-m25.pdf',
  sections: [
    { title: 'Winterizing', anchor: 'winterize' },
    { title: 'Fuel system', anchor: 'fuel' },
    { title: 'Raw-water cooling', anchor: 'cooling' },
  ],
  body: 'Reference manual for the Universal M-25 diesel fitted to Valkyrie.',
};

/** A manual with NO file (and no sections) — the download link must be absent. */
const RIGGING: ManualRec = {
  id: 'man-rigging',
  title: 'Standing rigging notes',
  kind: 'boat',
  body: 'Field notes on the standing rigging — no scanned PDF on file.',
};

const QUICKREF: Quickref[] = [
  { id: 'qr-reef', title: 'Reefing the main', body: 'Head up, ease the halyard to the reef mark, hook the tack.' },
  { id: 'qr-mob', title: 'Man overboard', body: 'Shout MOB and point continuously. Hit the MOB button.' },
];

/* ---- harness ---- */

function renderPage(partial: Partial<Session> = {}): void {
  mockedUseSession.mockReturnValue(session(partial));
  render(
    <MemoryRouter initialEntries={['/manuals']}>
      <ManualsPage />
    </MemoryRouter>,
  );
}

describe('ManualsPage', () => {
  beforeEach(() => {
    mockedApi.manuals.mockReset();
    mockedApi.quickref.mockReset();
    mockedApi.createManual.mockReset();
    mockedApi.updateManual.mockReset();
    mockedApi.deleteManual.mockReset();
    mockedApi.manuals.mockResolvedValue([ENGINE, RIGGING]);
    mockedApi.quickref.mockResolvedValue(QUICKREF);
  });
  afterEach(() => vi.clearAllMocks());

  it('renders the manual cards (kind badge + title) and the quick-reference cards', async () => {
    renderPage({ role: 'crew', isCrew: true, isAuthed: true });

    await waitFor(() =>
      expect(screen.getByText("Universal M-25 Owner's Manual")).toBeInTheDocument(),
    );
    expect(screen.getByText('Standing rigging notes')).toBeInTheDocument();
    // kind badge surfaces the manual's kind
    expect(screen.getByText(/engine/i)).toBeInTheDocument();
    // quick-reference cards
    expect(screen.getByText('Reefing the main')).toBeInTheDocument();
    expect(screen.getByText('Man overboard')).toBeInTheDocument();
  });

  it('expands a card to reveal its sections[] TOC + the body note', async () => {
    renderPage({ role: 'crew', isCrew: true, isAuthed: true });
    await waitFor(() => expect(screen.getByText("Universal M-25 Owner's Manual")).toBeInTheDocument());

    // Sections are revealed on expand (closed initially).
    expect(screen.queryByText('Winterizing')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Universal M-25 Owner's Manual"));

    await waitFor(() => expect(screen.getByText('Winterizing')).toBeInTheDocument());
    expect(screen.getByText('Fuel system')).toBeInTheDocument();
    expect(screen.getByText('Raw-water cooling')).toBeInTheDocument();
    expect(screen.getByText(/Reference manual for the Universal M-25/)).toBeInTheDocument();
  });

  it('a manual WITH a file links to the /files/manuals route; one WITHOUT shows no download', async () => {
    renderPage({ role: 'crew', isCrew: true, isAuthed: true });
    await waitFor(() => expect(screen.getByText("Universal M-25 Owner's Manual")).toBeInTheDocument());

    // Expand the file-bearing manual: a Download anchor points at the served file.
    const engineCard = screen.getByText("Universal M-25 Owner's Manual").closest('[data-testid="manual-card"]')!;
    await userEvent.click(screen.getByText("Universal M-25 Owner's Manual"));
    await waitFor(() => expect(within(engineCard as HTMLElement).getByText('Winterizing')).toBeInTheDocument());

    const link = within(engineCard as HTMLElement).getByRole('link', { name: /download|pdf|open/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/files/manuals/universal-m25.pdf');

    // The file-less manual: expand it and assert NO download link.
    const rigCard = screen.getByText('Standing rigging notes').closest('[data-testid="manual-card"]')!;
    await userEvent.click(screen.getByText('Standing rigging notes'));
    await waitFor(() =>
      expect(within(rigCard as HTMLElement).getByText(/Field notes on the standing rigging/)).toBeInTheDocument(),
    );
    expect(within(rigCard as HTMLElement).queryByRole('link', { name: /download|pdf|open/i })).not.toBeInTheDocument();
  });

  it('CREW sees NO write affordances (no add/edit/delete) — and never a cost input', async () => {
    renderPage({ role: 'crew', isCrew: true, isAuthed: true });
    await waitFor(() => expect(screen.getByText("Universal M-25 Owner's Manual")).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /add manual|new manual/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    // Manuals carry no money — there is never a cost field/input on this page.
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/cost|amount|price/i)).not.toBeInTheDocument();
  });

  it('OWNER in DEMO sees NO write affordances (writes carry denyInDemo)', async () => {
    renderPage({ role: 'owner', isOwner: true, isAuthed: true, demo: true });
    await waitFor(() => expect(screen.getByText("Universal M-25 Owner's Manual")).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /add manual|new manual/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete/i })).not.toBeInTheDocument();
  });

  it('OWNER (non-demo) can create a manual via the form kit', async () => {
    mockedApi.createManual.mockResolvedValue({
      id: 'man-electrical',
      title: 'Electrical panel reference',
      kind: 'boat',
      body: '',
    } as ManualRec);
    renderPage({ role: 'owner', isOwner: true, isAuthed: true });
    await waitFor(() => expect(screen.getByText("Universal M-25 Owner's Manual")).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /add manual|new manual/i }));

    // The required `title` field is present; fill it and save. Match the exact
    // "Title" label so we don't collide with the "Section title" sub-field.
    const titleField = screen.getByLabelText(/^Title/);
    await userEvent.type(titleField, 'Electrical panel reference');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockedApi.createManual).toHaveBeenCalledTimes(1));
    const payload = mockedApi.createManual.mock.calls[0]![0];
    expect(payload).toMatchObject({ title: 'Electrical panel reference' });
    // The server derives the id — we never send one.
    expect(payload).not.toHaveProperty('id');
  });

  it('OWNER (non-demo) can edit an existing manual (prefilled form → updateManual)', async () => {
    mockedApi.updateManual.mockResolvedValue({ ...ENGINE, title: 'Universal M-25 (rev B)' });
    renderPage({ role: 'owner', isOwner: true, isAuthed: true });
    await waitFor(() => expect(screen.getByText("Universal M-25 Owner's Manual")).toBeInTheDocument());

    const engineCard = screen.getByText("Universal M-25 Owner's Manual").closest('[data-testid="manual-card"]')!;
    await userEvent.click(within(engineCard as HTMLElement).getByRole('button', { name: /edit/i }));

    const titleField = screen.getByLabelText(/^Title/) as HTMLInputElement;
    expect(titleField.value).toBe("Universal M-25 Owner's Manual");
    await userEvent.clear(titleField);
    await userEvent.type(titleField, 'Universal M-25 (rev B)');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockedApi.updateManual).toHaveBeenCalledTimes(1));
    expect(mockedApi.updateManual.mock.calls[0]![0]).toBe('man-engine');
    expect(mockedApi.updateManual.mock.calls[0]![1]).toMatchObject({ title: 'Universal M-25 (rev B)' });
  });

  it('OWNER (non-demo) can delete a manual (confirm → deleteManual → list refetch)', async () => {
    mockedApi.deleteManual.mockResolvedValue(undefined);
    // After delete, the page refetches; return the list without the rigging manual.
    mockedApi.manuals
      .mockResolvedValueOnce([ENGINE, RIGGING])
      .mockResolvedValueOnce([ENGINE]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage({ role: 'owner', isOwner: true, isAuthed: true });
    await waitFor(() => expect(screen.getByText('Standing rigging notes')).toBeInTheDocument());

    const rigCard = screen.getByText('Standing rigging notes').closest('[data-testid="manual-card"]')!;
    await userEvent.click(within(rigCard as HTMLElement).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(mockedApi.deleteManual).toHaveBeenCalledWith('man-rigging'));
    await waitFor(() => expect(screen.queryByText('Standing rigging notes')).not.toBeInTheDocument());
    confirmSpy.mockRestore();
  });

  it('renders an error surface when the manuals fetch fails', async () => {
    mockedApi.manuals.mockRejectedValue(new Error('boom'));
    mockedApi.quickref.mockResolvedValue([]);
    renderPage({ role: 'crew', isCrew: true, isAuthed: true });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
