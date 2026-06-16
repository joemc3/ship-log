/**
 * RecordForm shell: a title, a body (the composed fields), Save/Cancel actions,
 * and a top error surface that renders an ApiError.message. Submitting calls
 * onSubmit; while the submit promise is pending the Save button is disabled
 * (busy). A rejected submit surfaces the error and re-enables Save.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordForm } from './RecordForm.js';
import { ApiError } from '../../lib/api.js';

describe('RecordForm', () => {
  it('renders the title, children, and Save/Cancel', () => {
    render(
      <RecordForm title="New trip" onSubmit={() => Promise.resolve()} onCancel={() => {}}>
        <div data-testid="body">fields</div>
      </RecordForm>,
    );
    expect(screen.getByText('New trip')).toBeInTheDocument();
    expect(screen.getByTestId('body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onSubmit when Save is clicked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RecordForm title="New trip" onSubmit={onSubmit} onCancel={() => {}}>
        <span />
      </RecordForm>,
    );
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <RecordForm title="Edit" onSubmit={() => Promise.resolve()} onCancel={onCancel}>
        <span />
      </RecordForm>,
    );
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('surfaces an ApiError.message when onSubmit rejects, and re-enables Save', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(400, 'date must be an ISO date (YYYY-MM-DD)'));
    render(
      <RecordForm title="New trip" onSubmit={onSubmit} onCancel={() => {}}>
        <span />
      </RecordForm>,
    );
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('date must be an ISO date'),
    );
    // Save is usable again after the failure.
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
  });

  it('falls back to a generic message for a non-ApiError rejection', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('network blip'));
    render(
      <RecordForm title="New trip" onSubmit={onSubmit} onCancel={() => {}}>
        <span />
      </RecordForm>,
    );
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
