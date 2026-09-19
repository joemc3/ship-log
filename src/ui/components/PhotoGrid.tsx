/**
 * PhotoGrid — the one way a record's `photos[]` is shown.
 *
 * Trips, maintenance items and inventory all carry photos; they all render
 * through this so they look and behave the same. Thumbnails are 4:3 tiles in
 * an auto-fill grid (two across on a phone), each a real button that opens
 * the Lightbox on that photo. Refs are the repo-relative `photos/<name>.jpg`
 * strings straight from the record; `photoUrl` resolves them.
 */
import { useState } from 'react';
import { photoUrl } from '../lib/photoUrl.js';
import { Lightbox } from './Lightbox.js';
import styles from './PhotoGrid.module.css';

export function PhotoGrid({ photos, alt }: { photos: string[]; alt: string }): JSX.Element | null {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  const urls = photos.map(photoUrl);

  return (
    <>
      <div className={styles.grid}>
        {urls.map((url, i) => (
          <button
            key={photos[i]}
            type="button"
            className={styles.thumb}
            aria-label={`Open photo ${i + 1} of ${urls.length}`}
            onClick={() => setOpen(i)}
          >
            <img src={url} alt={`${alt} — photo ${i + 1}`} loading="lazy" />
          </button>
        ))}
      </div>
      {open !== null && (
        <Lightbox urls={urls} alt={alt} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
