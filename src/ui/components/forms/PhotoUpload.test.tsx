/**
 * PhotoUpload: pick a file, call api.uploadPhoto, and on success hand the
 * returned ref back to the caller (to append to the record's photos[]). On a
 * 413/415/400 it surfaces a friendly, status-specific message and does NOT call
 * onUploaded. We mock the api client so no real network/multipart runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoUpload } from './PhotoUpload.js';
import { api, ApiError } from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  api: { uploadPhoto: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

const mockedUpload = vi.mocked(api.uploadPhoto);

function pick(name = 'shot.jpg', type = 'image/jpeg'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

beforeEach(() => {
  mockedUpload.mockReset();
});

describe('PhotoUpload', () => {
  it('uploads the chosen file and returns the ref to onUploaded', async () => {
    const user = userEvent.setup();
    const onUploaded = vi.fn();
    mockedUpload.mockResolvedValue({ ref: 'photos/abc123.jpg' });
    render(<PhotoUpload onUploaded={onUploaded} />);

    await user.upload(screen.getByLabelText(/add photo|upload/i), pick());
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('photos/abc123.jpg'));
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0]![0]).toBeInstanceOf(File);
  });

  it('surfaces a friendly 415 (unsupported type) and does not call onUploaded', async () => {
    const user = userEvent.setup();
    const onUploaded = vi.fn();
    mockedUpload.mockRejectedValue(new ApiError(415, 'unsupported image type'));
    render(<PhotoUpload onUploaded={onUploaded} />);

    // The `accept` attribute is only a hint; a file that passes the picker can
    // still be rejected server-side once its real bytes are sniffed (415).
    await user.upload(screen.getByLabelText(/add photo|upload/i), pick('x.jpg', 'image/jpeg'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/type|jpeg|png|webp/i));
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('surfaces a friendly 413 (too big)', async () => {
    const user = userEvent.setup();
    mockedUpload.mockRejectedValue(new ApiError(413, 'image exceeds the upload size limit'));
    render(<PhotoUpload onUploaded={() => {}} />);
    await user.upload(screen.getByLabelText(/add photo|upload/i), pick('huge.jpg'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too (large|big)|size/i));
  });

  it('surfaces a friendly 400 (wrong field / bad upload)', async () => {
    const user = userEvent.setup();
    mockedUpload.mockRejectedValue(new ApiError(400, 'multipart file field "photo" required'));
    render(<PhotoUpload onUploaded={() => {}} />);
    await user.upload(screen.getByLabelText(/add photo|upload/i), pick());
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
