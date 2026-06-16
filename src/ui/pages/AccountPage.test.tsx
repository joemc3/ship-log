/**
 * Component test for AccountPage — the change-password screen any authed user
 * reaches. It POSTs /api/password {currentPassword,newPassword} via the typed
 * client; the server enforces a min-8 newPassword and rejects a wrong
 * currentPassword (both 400). The page surfaces success AND each error, mirrors
 * the server's min-8 rule client-side (so an obviously-too-short password never
 * round-trips), and disables itself in demo mode (a server 400).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AccountPage from './AccountPage.js';
import { useSession, type Session } from '../state/session.js';
import { api, ApiError } from '../lib/api.js';

vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});

vi.mock('../lib/api.js', () => ({
  api: { changePassword: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const mockedUseSession = vi.mocked(useSession);
const mockedChange = vi.mocked(api.changePassword);

function session(partial: Partial<Session>): Session {
  return {
    loading: false,
    role: 'crew',
    username: 'mate',
    demo: false,
    ownerConfigured: true,
    isOwner: false,
    isCrew: true,
    isAuthed: true,
    refresh: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    ...partial,
  };
}

function renderAccount(): void {
  render(
    <MemoryRouter>
      <AccountPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedUseSession.mockReset();
  mockedChange.mockReset();
  mockedUseSession.mockReturnValue(session({}));
});

describe('AccountPage — change password', () => {
  it('submits current + new password and shows a success notice', async () => {
    const user = userEvent.setup();
    mockedChange.mockResolvedValue(undefined);
    renderAccount();

    await user.type(screen.getByLabelText(/current password/i), 'oldpass12');
    await user.type(screen.getByLabelText(/^new password/i), 'newpass12');
    await user.click(screen.getByRole('button', { name: /change password|update|save/i }));

    await waitFor(() => expect(mockedChange).toHaveBeenCalledWith('oldpass12', 'newpass12'));
    expect(await screen.findByText(/updated|changed|success/i)).toBeInTheDocument();
  });

  it('rejects an obviously too-short new password client-side (no round-trip)', async () => {
    const user = userEvent.setup();
    renderAccount();

    await user.type(screen.getByLabelText(/current password/i), 'oldpass12');
    await user.type(screen.getByLabelText(/^new password/i), 'short');
    await user.click(screen.getByRole('button', { name: /change password|update|save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/8/);
    expect(mockedChange).not.toHaveBeenCalled();
  });

  it('surfaces the server 400 (wrong current password) as an error', async () => {
    const user = userEvent.setup();
    mockedChange.mockRejectedValue(new ApiError(400, 'invalid current password'));
    renderAccount();

    await user.type(screen.getByLabelText(/current password/i), 'wrongpass1');
    await user.type(screen.getByLabelText(/^new password/i), 'newpass12');
    await user.click(screen.getByRole('button', { name: /change password|update|save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid current password/i);
  });
});

describe('AccountPage — demo', () => {
  it('disables the change-password control in demo mode with a notice', () => {
    mockedUseSession.mockReturnValue(session({ demo: true, role: 'owner', isOwner: true, isCrew: false }));
    renderAccount();

    expect(screen.getByText(/demo/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change password|update|save/i })).toBeDisabled();
  });
});
