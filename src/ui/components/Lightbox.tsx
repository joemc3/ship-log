/**
 * Lightbox — a full-screen viewer for a record's photos.
 *
 * Opened by PhotoGrid. Shows one photo at a time with `object-fit: contain`,
 * so nothing is cropped; the thumbnails are for recognition, this is for
 * actually seeing the picture. Previous/next wrap around the set. Closes on
 * the close button, the backdrop, or Escape; arrow keys navigate; a
 * horizontal swipe navigates on touch. Body scroll is locked while it is
 * open and restored on close.
 *
 * Rendered through a portal into document.body so that a parent card's
 * overflow:hidden (every record card has one) can never clip it.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.js';
import styles from './Lightbox.module.css';

const SWIPE_PX = 50;

export function Lightbox({
  urls,
  alt,
  index,
  onIndex,
  onClose,
}: {
  urls: string[];
  alt: string;
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}): JSX.Element | null {
  const count = urls.length;
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);

  const step = (delta: number): void => onIndex((index + delta + count) % count);

  // Keyboard: Escape closes, arrows navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Lock page scroll while open; put focus somewhere sensible.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (count === 0) return null;
  const url = urls[index]!;

  return createPortal(
    <div
      className={styles.backdrop}
      data-testid="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} — photo ${index + 1} of ${count}`}
      onClick={onClose}
    >
      <div
        className={styles.stage}
        data-testid="lightbox-stage"
        onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const start = touchX.current;
          touchX.current = null;
          const end = e.changedTouches[0]?.clientX;
          if (start === null || end === undefined) return;
          const dx = end - start;
          if (Math.abs(dx) >= SWIPE_PX) step(dx < 0 ? 1 : -1);
        }}
      >
        <img
          className={styles.image}
          src={url}
          alt={`${alt} — photo ${index + 1} of ${count}`}
          onClick={(e) => e.stopPropagation()}
        />

        <button
          ref={closeRef}
          type="button"
          className={`${styles.btn} ${styles.close}`}
          aria-label="Close"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <Icon name="close" s={18} />
        </button>

        {count > 1 && (
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.prev}`}
              aria-label="Previous photo"
              onClick={(e) => { e.stopPropagation(); step(-1); }}
            >
              <Icon name="chevron" s={18} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.next}`}
              aria-label="Next photo"
              onClick={(e) => { e.stopPropagation(); step(1); }}
            >
              <Icon name="chevron" s={18} />
            </button>
          </>
        )}

        <span className={styles.counter}>{index + 1} / {count}</span>
      </div>
    </div>,
    document.body,
  );
}
