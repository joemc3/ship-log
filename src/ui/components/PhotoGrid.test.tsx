/**
 * PhotoGrid + Lightbox — the shared photo presentation for every record that
 * carries a `photos[]` (trips, maintenance, inventory).
 *
 * Contracts asserted here:
 *   - each photo is a real button-wrapped thumbnail resolving to the /photos
 *     route, so it is keyboard-reachable and announces itself;
 *   - activating a thumbnail opens a modal lightbox showing THAT photo at full
 *     size, with a position counter;
 *   - next/previous walk the set and wrap; Escape and the backdrop close it;
 *     arrow keys navigate;
 *   - the lightbox is rendered into document.body (a portal), so a card's
 *     overflow:hidden can never clip it;
 *   - body scroll is locked while open and restored on close.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoGrid } from './PhotoGrid.js';

const PHOTOS = ['photos/t-2026-09-12-01.jpg', 'photos/t-2026-09-12-02.jpg', 'photos/t-2026-09-12-08.jpg'];

describe('PhotoGrid — thumbnails', () => {
  it('renders one button per photo, each wrapping an image served from /photos', () => {
    render(<PhotoGrid photos={PHOTOS} alt="Inaugural full family sail" />);
    const buttons = screen.getAllByRole('button', { name: /open photo/i });
    expect(buttons).toHaveLength(3);
    const img = buttons[0]!.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/photos/t-2026-09-12-01.jpg');
    expect(img.getAttribute('alt')).toContain('Inaugural full family sail');
  });

  it('renders nothing at all for an empty set', () => {
    const { container } = render(<PhotoGrid photos={[]} alt="x" />);
    expect(container.innerHTML).toBe('');
  });

  it('does not show a lightbox until a thumbnail is activated', () => {
    render(<PhotoGrid photos={PHOTOS} alt="x" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('PhotoGrid — lightbox', () => {
  it('opens on the photo that was clicked, at full size, with a counter', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={PHOTOS} alt="Family sail" />);
    await user.click(screen.getAllByRole('button', { name: /open photo/i })[1]!);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const full = dialog.querySelector('img')!;
    expect(full.getAttribute('src')).toBe('/photos/t-2026-09-12-02.jpg');
    expect(dialog).toHaveTextContent('2 / 3');
  });

  it('renders the dialog into document.body, outside the grid', async () => {
    const user = userEvent.setup();
    const { container } = render(<PhotoGrid photos={PHOTOS} alt="x" />);
    await user.click(screen.getAllByRole('button', { name: /open photo/i })[0]!);
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('next and previous walk the set and wrap at both ends', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={PHOTOS} alt="x" />);
    await user.click(screen.getAllByRole('button', { name: /open photo/i })[2]!);
    const src = (): string | null => screen.getByRole('dialog').querySelector('img')!.getAttribute('src');

    expect(src()).toBe('/photos/t-2026-09-12-08.jpg');
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(src()).toBe('/photos/t-2026-09-12-01.jpg'); // wrapped forward
    await user.click(screen.getByRole('button', { name: /previous/i }));
    expect(src()).toBe('/photos/t-2026-09-12-08.jpg'); // wrapped back
  });

  it('arrow keys navigate and Escape closes', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={PHOTOS} alt="x" />);
    await user.click(screen.getAllByRole('button', { name: /open photo/i })[0]!);

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog')).toHaveTextContent('2 / 3');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('dialog')).toHaveTextContent('1 / 3');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the close button and the backdrop both close it; clicking the photo does not', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={PHOTOS} alt="x" />);
    await user.click(screen.getAllByRole('button', { name: /open photo/i })[0]!);
    await user.click(screen.getByRole('dialog').querySelector('img')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /open photo/i })[0]!);
    fireEvent.click(screen.getByTestId('lightbox-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('locks body scroll while open and restores it on close', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={PHOTOS} alt="x" />);
    expect(document.body.style.overflow).toBe('');
    await user.click(screen.getAllByRole('button', { name: /open photo/i })[0]!);
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('a horizontal swipe on the photo navigates', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={PHOTOS} alt="x" />);
    await user.click(screen.getAllByRole('button', { name: /open photo/i })[0]!);
    const stage = screen.getByTestId('lightbox-stage');
    fireEvent.touchStart(stage, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 100, clientY: 100 }] });
    expect(screen.getByRole('dialog')).toHaveTextContent('2 / 3');
  });
});
