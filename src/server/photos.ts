import sharp from 'sharp';
import { createHash } from 'node:crypto';

const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // reject before decoding
const MAX_EDGE = 2048;                      // longest-edge budget
const JPEG_QUALITY = 80;

/** A photo-pipeline failure the caller maps to an HTTP status (415 | 413). */
export class PhotoError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PhotoError';
  }
}

export interface CompressedPhoto {
  bytes: Buffer;
  ext: 'jpg';
}

/** Validate type/size, then compress to budget (resize longest edge to MAX_EDGE,
 *  re-encode JPEG). Throws PhotoError(415|413) on bad input. */
export async function compressPhoto(buf: Buffer, mime: string): Promise<CompressedPhoto> {
  if (!ACCEPTED_MIME.has(mime)) throw new PhotoError(`unsupported image type: ${mime}`, 415);
  if (buf.length > MAX_UPLOAD_BYTES) throw new PhotoError('image exceeds the upload size limit', 413);
  const bytes = await sharp(buf)
    .rotate() // honor EXIF orientation before resizing
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return { bytes, ext: 'jpg' };
}

/** Content-addressed file name: stable for identical bytes (deterministic tests +
 *  natural dedupe). Returns just the name; the caller prefixes `photos/`. */
export function photoName(bytes: Buffer): string {
  return `${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.jpg`;
}
