import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AssistantDemo from './AssistantDemo.js';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  api: { assistantHistory: vi.fn(), assistantSend: vi.fn(), assistantReset: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

function renderDemo(): void {
  render(<MemoryRouter><AssistantDemo label="Ask the Purser" /></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

describe('AssistantDemo', () => {
  it('renders the scripted sample conversation', () => {
    renderDemo();
    expect(screen.getByText(/overheated coming back from Angel Island/i)).toBeInTheDocument();
    expect(screen.getByText(/sample conversation/i)).toBeInTheDocument();
  });

  it('shows the photo turn as a real image from the demo photo route', () => {
    renderDemo();
    const img = screen.getByRole('img', { name: /impeller/i });
    expect(img).toHaveAttribute('src', '/photos/m-engine-impeller.jpg');
  });

  it('says plainly that no agent is connected to this demo boat', () => {
    renderDemo();
    expect(screen.getByText(/no agent connected/i)).toBeInTheDocument();
  });

  it('appends the typed message then a canned reply, without calling the API', async () => {
    const user = userEvent.setup();
    renderDemo();
    await user.type(screen.getByPlaceholderText(/message|ask/i), 'when was the oil last changed?');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('when was the oil last changed?')).toBeInTheDocument();
    expect(
      await screen.findByText(/ashore for this demo/i, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(vi.mocked(api.assistantSend)).not.toHaveBeenCalled();
  });

  it('starts the sample thread at the top rather than auto-scrolling to its end', () => {
    const scrollTo = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollTo', { value: scrollTo, configurable: true });
    renderDemo();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls down once the visitor adds a turn of their own', async () => {
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollTo', { value: scrollTo, configurable: true });
    renderDemo();
    await user.type(screen.getByPlaceholderText(/message|ask/i), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(scrollTo).toHaveBeenCalled();
  });

  it('clears the composer after sending and ignores an empty message', async () => {
    const user = userEvent.setup();
    renderDemo();
    const box = screen.getByPlaceholderText(/message|ask/i);

    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(screen.queryByText(/ashore for this demo/i)).toBeNull();

    await user.type(box, 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(box).toHaveValue('');
  });
});
