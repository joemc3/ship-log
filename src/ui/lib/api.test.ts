import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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

  it('builds a manual file URL scoped to /files/manuals (strips the manuals/ prefix)', () => {
    expect(api.manualFileUrl('manuals/universal-m25.pdf')).toBe('/files/manuals/universal-m25.pdf');
    expect(api.manualFileUrl('universal-m25.pdf')).toBe('/files/manuals/universal-m25.pdf');
    expect(api.manualFileUrl('/manuals/a b.pdf')).toBe('/files/manuals/a%20b.pdf');
  });
});

describe('api client — writes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('createTrip POSTs flat fields + body as JSON to /api/trips (no id sent)', async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ id: 't-2026-06-16', date: '2026-06-16', body: 'just a sail' }, 201));
    const out = await api.createTrip({ date: '2026-06-16', body: 'just a sail' });
    expect(out.id).toBe('t-2026-06-16');
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/trips');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ date: '2026-06-16', body: 'just a sail' });
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(init.credentials).toBe('include');
  });

  it('updateTrip PUTs the patch to /api/trips/:id (id encoded)', async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ id: 't-2026-06-16', date: '2026-06-16', body: 'edited' }));
    await api.updateTrip('t-2026-06-16', { body: 'edited' });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/trips/t-2026-06-16');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ body: 'edited' });
  });

  it('completeMaintenance POSTs to /api/maintenance/:id/complete with optional note', async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ id: 'm-x', title: 'X', status: 'done' }));
    await api.completeMaintenance('m-x', { completed: '2026-06-16', note: 'fixed' });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/maintenance/m-x/complete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ completed: '2026-06-16', note: 'fixed' });
  });

  it('completeMaintenance defaults to an empty body when no opts given', async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ id: 'm-x', title: 'X', status: 'done' }));
    await api.completeMaintenance('m-x');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('owner create maps to the plural collection dir (vendor -> /api/vendors)', async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ id: 'v-sailmaker', name: 'Sailmaker' }, 201));
    await api.createVendor({ name: 'Sailmaker' });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/vendors');
    expect(init.method).toBe('POST');
  });

  it('owner create maps cost -> /api/costs and maintenance -> /api/maintenance', async () => {
    const f1 = mockFetchOnce(jsonResponse({ id: 'c-x', date: '2026-06-16', item: 'Fuel', amount: 40 }, 201));
    await api.createCost({ date: '2026-06-16', item: 'Fuel', amount: 40 });
    expect(f1.mock.calls[0]![0]).toBe('/api/costs');
    const f2 = mockFetchOnce(jsonResponse({ id: 'm-x', title: 'X', status: 'due' }, 201));
    await api.createMaintenance({ title: 'X', status: 'due' });
    expect(f2.mock.calls[0]![0]).toBe('/api/maintenance');
    const f3 = mockFetchOnce(jsonResponse({ id: 'inv-x', name: 'Flares' }, 201));
    await api.createInventory({ name: 'Flares' });
    expect(f3.mock.calls[0]![0]).toBe('/api/inventory');
    const f4 = mockFetchOnce(jsonResponse({ id: 'man-x', title: 'Engine' }, 201));
    await api.createManual({ title: 'Engine' });
    expect(f4.mock.calls[0]![0]).toBe('/api/manuals');
  });

  it('owner update PUTs to the plural collection dir with the id encoded', async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ id: 'inv-flares-near gate', name: 'Flares' }));
    await api.updateInventory('inv-x y', { name: 'Flares' });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/inventory/inv-x%20y');
    expect(init.method).toBe('PUT');
  });

  it('owner delete DELETEs and resolves void on 204', async () => {
    const fetchMock = mockFetchOnce(new Response(null, { status: 204 }));
    await expect(api.deleteCost('c-x')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/costs/c-x');
    expect(init.method).toBe('DELETE');
  });

  it('deleteTrip DELETEs /api/trips/:id and resolves void on 204', async () => {
    const fetchMock = mockFetchOnce(new Response(null, { status: 204 }));
    await expect(api.deleteTrip('t-2026-06-16')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/trips/t-2026-06-16');
    expect(init.method).toBe('DELETE');
  });

  it('a crew write to an owner-only route surfaces the 403 as an ApiError', async () => {
    mockFetchOnce(jsonResponse({ error: 'owner only' }, 403));
    const err = await api.createCost({ date: '2026-06-16', item: 'Fuel', amount: 40 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.isForbidden).toBe(true);
  });

  it('a write in demo mode surfaces the denyInDemo 403', async () => {
    mockFetchOnce(jsonResponse({ error: 'disabled in demo mode' }, 403));
    const err = await api.createTrip({ date: '2026-06-16' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe('disabled in demo mode');
  });

  it('uploadPhoto POSTs a multipart body with field "photo" and returns { ref }', async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ ref: 'photos/abc123.jpg' }, 201));
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.jpg', { type: 'image/jpeg' });
    const out = await api.uploadPhoto(file);
    expect(out).toEqual({ ref: 'photos/abc123.jpg' });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/photos');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    // A multipart upload: the body is FormData and we must NOT set Content-Type
    // ourselves (the browser sets the multipart boundary).
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('photo')).toBeInstanceOf(File);
    expect(new Headers(init.headers).get('Content-Type')).toBeNull();
  });

  it('uploadPhoto maps a 415 unsupported-type to an ApiError', async () => {
    mockFetchOnce(jsonResponse({ error: 'unsupported image type' }, 415));
    const file = new File([new Uint8Array([1])], 'shot.gif', { type: 'image/gif' });
    const err = await api.uploadPhoto(file).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(415);
  });

  it('uploadPhoto maps a 413 too-big to an ApiError', async () => {
    mockFetchOnce(jsonResponse({ error: 'image exceeds the upload size limit' }, 413));
    const file = new File([new Uint8Array([1])], 'huge.jpg', { type: 'image/jpeg' });
    const err = await api.uploadPhoto(file).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(413);
  });
});

describe('api — assistant', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('assistantHistory GETs the thread', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ turns: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.assistantHistory()).resolves.toEqual({ turns: [] });
    expect((fetchMock.mock.calls[0] as unknown as [string, ...unknown[]])[0]).toBe('/api/assistant/history');
  });

  it('assistantSend streams deltas via onDelta', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('event: delta\ndata: "Hel"\n\n'));
        c.enqueue(enc.encode('event: delta\ndata: "lo"\n\n'));
        c.enqueue(enc.encode('event: done\ndata: {"ok":true}\n\n'));
        c.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const { api } = await import('./api.js');
    const got: string[] = [];
    await api.assistantSend('hi', (d) => got.push(d));
    expect(got.join('')).toBe('Hello');
  });

  it('assistantSend throws on an SSE error event', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode('event: error\ndata: {"error":"nope"}\n\n')); c.close(); },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const { api } = await import('./api.js');
    await expect(api.assistantSend('hi', () => {})).rejects.toThrow(/nope/);
  });
});
