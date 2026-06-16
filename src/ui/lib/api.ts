/**
 * Typed client for the Ship's Log JSON API. The SPA is served same-origin (in
 * dev, Vite proxies /api + /photos to Express), so every request is relative and
 * carries the HTTP-only session cookie via `credentials: 'include'`. The viewer's
 * role is learned from GET /api/me — never by reading the cookie.
 *
 * All non-2xx responses are normalized to an `ApiError` carrying the HTTP status
 * and the server's `{ error }` message, so callers can branch on 401 vs 403 vs
 * 404/409/413/415/429/500 distinctly (e.g. crew hitting /api/costs gets 403).
 */
import type {
  Me,
  Welcome,
  Boat,
  TripRec,
  MaintenanceRec,
  InventoryRec,
  VendorRec,
  ManualRec,
  CostRec,
  Quickref,
  SearchHit,
  Derived,
  LoginResult,
} from './types.js';

/** A normalized API failure: HTTP status + the server's error message. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

const JSON_HEADERS = { Accept: 'application/json' } as const;

async function parseError(res: Response): Promise<ApiError> {
  let message = `request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (body && typeof body.error === 'string' && body.error) message = body.error;
  } catch {
    // Non-JSON error body (e.g. an HTML 500 from a proxy) — keep the generic message.
  }
  return new ApiError(res.status, message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { ...JSON_HEADERS, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const api = {
  // ---- discovery / public ----
  me: () => get<Me>('/api/me'),
  welcome: () => get<Welcome>('/api/welcome'),

  // ---- reads (crew + owner) ----
  boat: () => get<Boat>('/api/boat'),
  trips: () => get<TripRec[]>('/api/trips'),
  trip: (id: string) => get<TripRec>(`/api/trips/${encodeURIComponent(id)}`),
  maintenance: () => get<MaintenanceRec[]>('/api/maintenance'),
  maintenanceItem: (id: string) => get<MaintenanceRec>(`/api/maintenance/${encodeURIComponent(id)}`),
  inventory: () => get<InventoryRec[]>('/api/inventory'),
  vendors: () => get<VendorRec[]>('/api/vendors'),
  manuals: () => get<ManualRec[]>('/api/manuals'),
  quickref: () => get<Quickref[]>('/api/quickref'),
  search: (q: string) => get<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  derived: () => get<Derived>('/api/derived'),

  // ---- owner-only reads (crew/guest => 403) ----
  costs: () => get<CostRec[]>('/api/costs'),
  cost: (id: string) => get<CostRec>(`/api/costs/${encodeURIComponent(id)}`),

  // ---- auth ----
  login: (username: string, password: string) =>
    postJson<LoginResult>('/api/login', { username, password }),
  logout: () => request<void>('/api/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/api/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // ---- writes (thin stubs typed for later milestones) ----
  createTrip: (fields: Record<string, unknown> & { body?: string }) =>
    postJson<TripRec>('/api/trips', fields),
  updateTrip: (id: string, patch: Record<string, unknown>) =>
    request<TripRec>(`/api/trips/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  completeMaintenance: (id: string, opts: { completed?: string; note?: string } = {}) =>
    postJson<MaintenanceRec>(`/api/maintenance/${encodeURIComponent(id)}/complete`, opts),
  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.append('photo', file);
    return request<{ ref: string }>('/api/photos', { method: 'POST', body: form });
  },
} as const;

export type Api = typeof api;
