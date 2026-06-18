import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AssistantPage from './AssistantPage.js';
import { useSession, type Session } from '../state/session.js';
import { api } from '../lib/api.js';

vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});
vi.mock('../lib/api.js', () => ({
  api: { assistantHistory: vi.fn(), assistantSend: vi.fn(), assistantReset: vi.fn() },
  ApiError: class ApiError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s; } },
}));

const mockedUseSession = vi.mocked(useSession);

function session(partial: Partial<Session>): Session {
  return {
    loading: false, role: 'crew', username: 'mate', demo: false, ownerConfigured: true,
    isOwner: false, isCrew: true, isAuthed: true,
    assistantEnabled: true, assistantLabel: 'Ask the Purser',
    refresh: vi.fn(), login: vi.fn(), logout: vi.fn(),
    ...partial,
  };
}

function renderPage(): void {
  render(<MemoryRouter><AssistantPage /></MemoryRouter>);
}

beforeEach(() => {
  mockedUseSession.mockReset();
  vi.mocked(api.assistantHistory).mockReset();
  vi.mocked(api.assistantSend).mockReset();
  vi.mocked(api.assistantReset).mockReset();
  mockedUseSession.mockReturnValue(session({}));
  vi.mocked(api.assistantHistory).mockResolvedValue({ turns: [] });
});

describe('AssistantPage', () => {
  it('renders the existing shared thread', async () => {
    vi.mocked(api.assistantHistory).mockResolvedValue({
      turns: [
        { role: 'user', name: 'cap', content: 'morning', at: '2024-07-01T00:00:00Z' },
        { role: 'assistant', content: 'Morning, Cap.', at: '2024-07-01T00:00:01Z' },
      ],
    });
    renderPage();
    expect(await screen.findByText('morning')).toBeInTheDocument();
    expect(await screen.findByText('Morning, Cap.')).toBeInTheDocument();
  });

  it('sends a message and renders streamed deltas', async () => {
    const user = userEvent.setup();
    vi.mocked(api.assistantSend).mockImplementation(async (_msg, onDelta) => {
      onDelta('All '); onDelta('good.');
    });
    renderPage();
    await user.type(screen.getByPlaceholderText(/message|ask/i), 'are we good?');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(vi.mocked(api.assistantSend)).toHaveBeenCalledWith('are we good?', expect.any(Function)));
    expect(await screen.findByText('are we good?')).toBeInTheDocument();
    expect(await screen.findByText('All good.')).toBeInTheDocument();
  });

  it('shows the reset control to an owner and clears the thread', async () => {
    const user = userEvent.setup();
    mockedUseSession.mockReturnValue(session({ role: 'owner', isOwner: true, isCrew: false }));
    vi.mocked(api.assistantReset).mockResolvedValue(undefined);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /reset|clear/i }));
    await waitFor(() => expect(vi.mocked(api.assistantReset)).toHaveBeenCalled());
  });

  it('hides the reset control from crew', async () => {
    renderPage();
    await screen.findByPlaceholderText(/message|ask/i);
    expect(screen.queryByRole('button', { name: /reset|clear/i })).toBeNull();
  });

  it('shows an unavailable notice when the assistant is disabled', () => {
    mockedUseSession.mockReturnValue(session({ assistantEnabled: false }));
    renderPage();
    expect(screen.getByText(/not available|unavailable|disabled/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/message|ask/i)).toBeNull();
  });
});
