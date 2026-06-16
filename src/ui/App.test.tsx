import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App.js';
import type { Me, Welcome } from './lib/types.js';

/**
 * App integration smoke test: the real session provider + router + shell, driven
 * by a mocked fetch. A guest gets the Welcome page and a Login affordance; the
 * shell brand name comes from /api/welcome (never hardcoded).
 */
const GUEST_ME: Me = { role: 'guest', username: null, demo: false, ownerConfigured: true };
const WELCOME: Welcome = { name: 'Valkyrie', welcome: {} };

function routeFetch(url: string): Response {
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  if (path.startsWith('/api/me')) return json(GUEST_ME);
  if (path.startsWith('/api/welcome')) return json(WELCOME);
  if (path.startsWith('/api/derived')) return json({ attention: 0, inventoryTasks: [] });
  return json({ error: 'not found' }, 404);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('App (integration smoke)', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => routeFetch(String(input))));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the shell with the boat brand from /api/welcome', async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelector('.brand-name')).toHaveTextContent('Valkyrie'));
    expect(document.querySelector('.shell')).toBeInTheDocument();
  });

  it('shows the guest Welcome page and a Login affordance', async () => {
    render(<App />);
    // The guest landing is the real Welcome page, bound to /api/welcome. Target a
    // stable page-body marker — the hero eyebrow — rather than the nav label
    // ("Welcome" also appears in the sidebar nav).
    expect(await screen.findByText(/Welcome aboard/i)).toBeInTheDocument();
    // A guest gets a Login affordance to /login. The real Shell shows one in the
    // sidebar AND the Welcome hero shows one, so there are legitimately several;
    // assert that at least one /login link is present.
    const loginLinks = await screen.findAllByRole('link', { name: /log in/i });
    expect(loginLinks.length).toBeGreaterThan(0);
    expect(loginLinks[0]).toHaveAttribute('href', '/login');
  });

  it('calls GET /api/me on mount', async () => {
    render(<App />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/me', expect.anything()));
  });
});
