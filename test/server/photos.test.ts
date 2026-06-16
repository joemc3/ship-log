import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { compressPhoto, photoName, PhotoError } from '../../src/server/photos.js';

function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 80, b: 160 } } }).png().toBuffer();
}

describe('compressPhoto', () => {
  it('resizes within the budget and re-encodes as jpeg', async () => {
    const big = await makePng(4000, 3000);
    const out = await compressPhoto(big, 'image/png');
    expect(out.ext).toBe('jpg');
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2048);
  });

  it('rejects an unsupported mime type with 415', async () => {
    await expect(compressPhoto(Buffer.from('x'), 'image/gif')).rejects.toBeInstanceOf(PhotoError);
    await expect(compressPhoto(Buffer.from('x'), 'image/gif')).rejects.toMatchObject({ status: 415 });
  });

  it('rejects an oversized upload with 413 BEFORE decoding', async () => {
    const huge = Buffer.alloc(26 * 1024 * 1024, 1); // size checked before sharp touches it
    await expect(compressPhoto(huge, 'image/jpeg')).rejects.toMatchObject({ status: 413 });
  });
});

describe('photoName', () => {
  it('is deterministic for identical bytes and ends in .jpg', () => {
    expect(photoName(Buffer.from('same'))).toBe(photoName(Buffer.from('same')));
    expect(photoName(Buffer.from('same'))).toMatch(/^[0-9a-f]{12}\.jpg$/);
  });
});
