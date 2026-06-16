/**
 * RecordForm — the shell every create/edit form composes into: an eyebrow/title
 * header, the composed field children, a Save/Cancel action row, and a top error
 * surface that renders an ApiError.message (the server's validation/permission
 * message) so a 400/403/409 reads back to the user. Submitting awaits onSubmit;
 * while it's pending Save shows a busy state and is disabled (guarding against a
 * double-write into the serial write queue). A rejected submit surfaces the
 * message and re-enables Save.
 *
 * It is deliberately data-agnostic: pages own the field state + the buildPayload
 * → api.createX/updateX call, and pass `onSubmit` as that async action.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../Icon.js';
import { ApiError } from '../../lib/api.js';
import styles from './forms.module.css';

export function RecordForm({
  title,
  eyebrow,
  children,
  onSubmit,
  onCancel,
  saveLabel = 'Save',
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  /** The async write action; reject with an ApiError to surface its message. */
  onSubmit: () => Promise<void>;
  onCancel: () => void;
  saveLabel?: string;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate>
      <div className={styles.formHead}>
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2 className="page-title" style={{ margin: eyebrow ? '4px 0 0' : 0 }}>{title}</h2>
        </div>
      </div>

      {error && (
        <div className={`card card-pad ${styles.errorSurface}`} role="alert">
          <span className="flex items-center gap-8">
            <Icon name="alert" s={16} />
            {error}
          </span>
        </div>
      )}

      <div className="stack">{children}</div>

      <div className={styles.actions}>
        <button type="submit" className="btn btn-brass" disabled={busy}>
          <Icon name="check" s={16} />
          {busy ? 'Saving…' : saveLabel}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
