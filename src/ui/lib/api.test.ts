import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from './api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetchOnce(res: Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => res);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends credentials and an Accept header on GETs', async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ role: 'guest', username: null, demo: false, ownerConfigured: true }));
    await api.me();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ credentials: 'include' }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
  });

  it('returns the parsed JSON body on success', async () => {
    mockFetchOnce(jsonResponse({ role: 'owner', username: 'cap', demo: false, ownerConfigured: true }));
    const me = await api.me();
    expect(me).toEqual({ role: 'owner', username: 'cap', demo: false, ownerConfigured: true });
  });

  it('maps a 401 to ApiError with status 401 and the server error message', async () => {
    mockFetchOnce(jsonResponse({ error: 'authentication required' }, 401));
    await expect(api.boat()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'authentication required',
    });
  });

  it('distinguishes 403 (forbidden) from 401', async () => {
    mockFetchOnce(jsonResponse({ error: 'owner only' }, 403));
    const err = await api.costs().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.isForbidden).toBe(true);
    expect(err.isUnauthorized).toBe(false);
  });

  it('maps 404/409/413/415/429/500 to ApiError carrying the status', async () => {
    for (const status of [404, 409, 413, 415, 429, 500]) {
      mockFetchOnce(jsonResponse({ error: `boom ${status}` }, status));
      const err = await api.trips().catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(status);
      expect(err.message).toBe(`boom ${status}`);
    }
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    const res = new Response('<html>nope</html>', { status: 500, headers: { 'Content-Type': 'text/html' } });
    mockFetchOnce(res);
    const err = await api.search('x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('POSTs login with a JSON body and returns the result', async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ username: 'cap', role: 'owner' }));
    const out = await api.login('cap', 'secretpass');
    expect(out).toEqual({ username: 'cap', role: 'owner' });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'cap', password: 'secretpass' });
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('logout returns void on a 204 (no body to parse)', async () => {
    mockFetchOnce(new Response(null, { status: 204 }));
    await expect(api.logout()).resolves.toBeUndefined();
  });

  it('changePassword returns void on a 204', async () => {
    mockFetchOnce(new Response(null, { status: 204 }));
    await expect(api.changePassword('oldpass12', 'newpass12')).resolves.toBeUndefined();
  });

  it('login maps a 429 rate-limit to an ApiError', async () => {
    mockFetchOnce(jsonResponse({ error: 'too many' }, 429));
    const err = await api.login('a', 'b').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
  });

  it('exposes a derived endpoint returning attention + tasks', async () => {
    mockFetchOnce(jsonResponse({ attention: 3, inventoryTasks: [] }));
    const d = await api.derived();
    expect(d.attention).toBe(3);
    expect(d.inventoryTasks).toEqual([]);
  });

  it('encodes the search query', async () => {
    const fetchMock = mockFetchOnce(jsonResponse([]));
    await api.search('frayed halyard');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/search?q=frayed%20halyard');
  });
});
