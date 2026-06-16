/**
 * Component test for AdminPage — the OWNER-ONLY user administration screen
 * (the route guard + a server 403 keep crew/guest out; this test drives the
 * happy/error paths an owner sees). It exercises GET /api/users plus the create /
 * update (role + reset password) / delete flows and asserts each distinct server
 * status reads back to the user:
 *   - create 201 → the new user appears; 409 → "already exists"; 400 → validation
 *   - update 204 (role change / password reset); 409 → last-owner guard
 *   - delete 204 (removed from the list); 409 → last-owner/self guard; 404 → gone
 * After every successful mutation the list is re-fetched so the table reflects
 * the authoritative server state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminPage from './AdminPage.js';
import { api, ApiError } from '../lib/api.js';
import type { User } from '../lib/types.js';

vi.mock('../lib/api.js', () => ({
  api: {
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const mockedList = vi.mocked(api.listUsers);
const mockedCreate = vi.mocked(api.createUser);
const mockedUpdate = vi.mocked(api.updateUser);
const mockedDelete = vi.mocked(api.deleteUser);

const CAP: User = { username: 'cap', role: 'owner' };
const MATE: User = { username: 'mate', role: 'crew' };

function renderAdmin(): void {
  render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
}

/** Find the table row (or card) for a username — the page renders one per user. */
function rowFor(username: string): HTMLElement {
  return screen.getByTestId(`user-${username}`);
}

beforeEach(() => {
  mockedList.mockReset();
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
  mockedDelete.mockReset();
  mockedList.mockResolvedValue([CAP, MATE]);
});

describe('AdminPage — list', () => {
  it('lists users from GET /api/users with their roles', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('cap')).toBeInTheDocument());
    expect(screen.getByText('mate')).toBeInTheDocument();
    // Roles surfaced per row (the badge, not the role-select options).
    expect(screen.getByTestId('role-cap')).toHaveTextContent(/owner/i);
    expect(screen.getByTestId('role-mate')).toHaveTextContent(/crew/i);
  });
});

describe('AdminPage — create', () => {
  it('creates a user and re-fetches the list (201)', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue({ username: 'newbie', role: 'crew' });
    // After create, the re-fetched list includes the new user.
    mockedList
      .mockResolvedValueOnce([CAP, MATE])
      .mockResolvedValueOnce([CAP, MATE, { username: 'newbie', role: 'crew' }]);
    renderAdmin();
    await waitFor(() => expect(screen.getByText('cap')).toBeInTheDocument());

    const form = screen.getByTestId('create-user');
    await user.type(within(form).getByLabelText(/username/i), 'newbie');
    await user.type(within(form).getByLabelText(/temp(orary)? password|password/i), 'temppass1');
    await user.selectOptions(within(form).getByLabelText(/role/i), 'crew');
    await user.click(within(form).getByRole('button', { name: /add user|create|invite/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledWith('newbie', 'temppass1', 'crew'));
    await waitFor(() => expect(screen.getByText('newbie')).toBeInTheDocument());
  });

  it('surfaces a 409 (already exists) without losing the form', async () => {
    const user = userEvent.setup();
    mockedCreate.mockRejectedValue(new ApiError(409, 'user already exists'));
    renderAdmin();
    await waitFor(() => expect(screen.getByText('cap')).toBeInTheDocument());

    const form = screen.getByTestId('create-user');
    await user.type(within(form).getByLabelText(/username/i), 'cap');
    await user.type(within(form).getByLabelText(/temp(orary)? password|password/i), 'temppass1');
    await user.selectOptions(within(form).getByLabelText(/role/i), 'owner');
    await user.click(within(form).getByRole('button', { name: /add user|create|invite/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });

  it('surfaces a 400 (validation) from the server', async () => {
    const user = userEvent.setup();
    mockedCreate.mockRejectedValue(new ApiError(400, 'username (1-64 chars, not blank), password (min 8 chars), role (owner|crew) required'));
    renderAdmin();
    await waitFor(() => expect(screen.getByText('cap')).toBeInTheDocument());

    const form = screen.getByTestId('create-user');
    await user.type(within(form).getByLabelText(/username/i), 'x');
    await user.type(within(form).getByLabelText(/temp(orary)? password|password/i), 'temppass1');
    await user.selectOptions(within(form).getByLabelText(/role/i), 'crew');
    await user.click(within(form).getByRole('button', { name: /add user|create|invite/i }));

    expect(await screen.findByText(/min 8 chars|required/i)).toBeInTheDocument();
  });
});

describe('AdminPage — update (role + reset password)', () => {
  it('changes a role via PUT and re-fetches (204)', async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue(undefined);
    mockedList
      .mockResolvedValueOnce([CAP, MATE])
      .mockResolvedValueOnce([CAP, { username: 'mate', role: 'owner' }]);
    renderAdmin();
    await waitFor(() => expect(screen.getByText('mate')).toBeInTheDocument());

    // Promote mate to owner via the per-row role control.
    await user.selectOptions(within(rowFor('mate')).getByLabelText(/role/i), 'owner');

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledWith('mate', { role: 'owner' }));
    await waitFor(() => expect(screen.getByTestId('role-mate')).toHaveTextContent(/owner/i));
  });

  it('resets a password via PUT (204) and shows a success notice', async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue(undefined);
    renderAdmin();
    await waitFor(() => expect(screen.getByText('mate')).toBeInTheDocument());

    await user.click(within(rowFor('mate')).getByRole('button', { name: /reset password/i }));
    // A small modal collects the new temp password.
    const modal = await screen.findByRole('dialog');
    await user.type(within(modal).getByLabelText(/new password/i), 'freshpass1');
    // The confirm button reads "Reset" (its leading icon contributes its name too).
    await user.click(within(modal).getByRole('button', { name: /reset|save|confirm/i }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledWith('mate', { password: 'freshpass1' }));
    // The page-level success notice (the row's "Reset password" button also
    // matches /reset/, so scope the assertion to the notice surface).
    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent(/reset|updated|success/i));
  });

  it('surfaces a 409 last-owner guard when demoting the only owner', async () => {
    const user = userEvent.setup();
    mockedUpdate.mockRejectedValue(new ApiError(409, 'cannot demote the last owner'));
    mockedList.mockResolvedValue([CAP, MATE]);
    renderAdmin();
    await waitFor(() => expect(screen.getByText('cap')).toBeInTheDocument());

    await user.selectOptions(within(rowFor('cap')).getByLabelText(/role/i), 'crew');

    expect(await screen.findByText(/last owner/i)).toBeInTheDocument();
  });
});

describe('AdminPage — delete', () => {
  it('deletes a user and re-fetches (204)', async () => {
    const user = userEvent.setup();
    mockedDelete.mockResolvedValue(undefined);
    mockedList
      .mockResolvedValueOnce([CAP, MATE])
      .mockResolvedValueOnce([CAP]);
    renderAdmin();
    await waitFor(() => expect(screen.getByText('mate')).toBeInTheDocument());

    await user.click(within(rowFor('mate')).getByRole('button', { name: /delete mate|remove mate/i }));
    // A confirmation modal guards the destructive action.
    const modal = await screen.findByRole('dialog');
    await user.click(within(modal).getByRole('button', { name: /delete|remove|confirm|yes/i }));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('mate'));
    await waitFor(() => expect(screen.queryByText('mate')).not.toBeInTheDocument());
  });

  it('surfaces a 409 (last-owner/self guard) on delete', async () => {
    const user = userEvent.setup();
    mockedDelete.mockRejectedValue(new ApiError(409, 'cannot delete the last owner'));
    renderAdmin();
    await waitFor(() => expect(screen.getByText('cap')).toBeInTheDocument());

    await user.click(within(rowFor('cap')).getByRole('button', { name: /delete cap|remove cap/i }));
    const modal = await screen.findByRole('dialog');
    await user.click(within(modal).getByRole('button', { name: /delete|remove|confirm|yes/i }));

    expect(await screen.findByText(/last owner/i)).toBeInTheDocument();
  });

  it('surfaces a 404 (no such user) on delete', async () => {
    const user = userEvent.setup();
    mockedDelete.mockRejectedValue(new ApiError(404, 'no such user'));
    renderAdmin();
    await waitFor(() => expect(screen.getByText('mate')).toBeInTheDocument());

    await user.click(within(rowFor('mate')).getByRole('button', { name: /delete mate|remove mate/i }));
    const modal = await screen.findByRole('dialog');
    await user.click(within(modal).getByRole('button', { name: /delete|remove|confirm|yes/i }));

    expect(await screen.findByText(/no such user/i)).toBeInTheDocument();
  });
});
