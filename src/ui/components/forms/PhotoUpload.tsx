/**
 * PhotoUpload — pick an image, upload it via `api.uploadPhoto` (multipart field
 * "photo"), and on success hand the returned `photos/<hash>.jpg` ref to the
 * caller (to append to the record's photos[] via a subsequent PUT). The server
 * compresses + content-addresses the file; we only orchestrate the call and turn
 * its status codes into friendly, status-specific copy:
 *   - 413 → too large
 *   - 415 → unsupported type (jpeg/png/webp only)
 *   - 400 → bad upload (wrong field / no file)
 * It NEVER touches monetary data; photos carry no cost fields.
 */
import { useId, useRef, useState } from 'react';
import { Icon } from '../Icon.js';
import { api, ApiError } from '../../lib/api.js';
import styles from './forms.module.css';

/** Map an upload failure to friendly, status-specific copy. */
function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 413:
        return 'That image is too large. Try a smaller photo.';
      case 415:
        return 'Unsupported image type — use a JPEG, PNG, or WebP.';
      case 400:
        return 'That upload could not be read. Please choose an image file.';
      case 403:
        return 'Uploading photos is disabled here.';
      default:
        return err.message || 'Upload failed. Please try again.';
    }
  }
  return 'Upload failed. Please try again.';
}

export function PhotoUpload({
  onUploaded,
  label = 'Add photo',
}: {
  /** Called with the new `photos/<hash>.jpg` ref on a successful upload. */
  onUploaded: (ref: string) => void;
  label?: string;
}): JSX.Element {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { ref } = await api.uploadPhoto(file);
      onUploaded(ref);
      setDone(ref);
    } catch (err: unknown) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
      // Allow re-selecting the same file after an error.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className={styles.field}>
      <div className={styles.photoDrop}>
        <label htmlFor={inputId} className="btn btn-ghost" style={{ cursor: busy ? 'wait' : 'pointer' }}>
          <Icon name="camera" s={16} />
          {busy ? 'Uploading…' : label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className={styles.hiddenInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label={label}
          disabled={busy}
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        {done && !error && (
          <span className={`${styles.photoStatus} ${styles.ok}`}>
            <Icon name="check" s={14} /> Photo added
          </span>
        )}
      </div>
      {error && (
        <p className={`${styles.photoStatus} ${styles.bad} ${styles.fieldError}`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
