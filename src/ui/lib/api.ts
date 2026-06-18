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
  User,
  AssignableRole,
  AssistantTurn,
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

function putJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(path: string): Promise<void> {
  return request<void>(path, { method: 'DELETE' });
}

/** Encode a record id for safe interpolation into a route path. */
const eid = (id: string): string => encodeURIComponent(id);

/**
 * A write payload: flat frontmatter fields, plus an optional Markdown `body`.
 * The server derives the record id (we never send one), validates against the
 * Zod schema, and redacts the response by role — so a crew/guest write response
 * never carries a monetary field. Callers build this via the form-kit's
 * `buildPayload`, which OMITS blank optionals (partial entries are first-class).
 */
export type WritePayload = Record<string, unknown> & { body?: string };

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

  // ---- served files (not JSON): a manual's PDF/markdown, scoped to manuals/ ----
  // A record's `file:` field is stored as `manuals/<name>` (or a bare name); the
  // /files/manuals/:name route serves it root-anchored under the same auth
  // posture as reads. This builds the href; the browser GETs it directly.
  manualFileUrl: (file: string): string => {
    const name = file.replace(/^\/+/, '').replace(/^manuals\//, '');
    return `/files/manuals/${encodeURIComponent(name)}`;
  },

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

  // ---- user administration (owner-only; crew/guest => 403) ----
  // The list never carries a password hash. Create takes a temp password the new
  // user changes via /account; update sets a role and/or resets a password (omit
  // a field to leave it unchanged). Delete + last-owner/self guards surface as
  // 409; an unknown username as 404; validation as 400.
  listUsers: () => get<User[]>('/api/users'),
  createUser: (username: string, password: string, role: AssignableRole) =>
    postJson<User>('/api/users', { username, password, role }),
  updateUser: (username: string, patch: { role?: AssignableRole; password?: string }) =>
    request<void>(`/api/users/${eid(username)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  deleteUser: (username: string) => del(`/api/users/${eid(username)}`),

  // ---- writes: trips (crew + owner) ----
  // The server derives the id from `date` (do NOT send one) and splits out
  // `body`. A partial trip is first-class: { date } alone is valid.
  createTrip: (fields: WritePayload) => postJson<TripRec>('/api/trips', fields),
  updateTrip: (id: string, patch: WritePayload) => putJson<TripRec>(`/api/trips/${eid(id)}`, patch),
  // All deletes are owner-only server-side (crew gets 403) — including trips.
  deleteTrip: (id: string) => del(`/api/trips/${eid(id)}`),

  // ---- writes: maintenance complete (crew + owner; never touches costEst) ----
  completeMaintenance: (id: string, opts: { completed?: string; note?: string } = {}) =>
    postJson<MaintenanceRec>(`/api/maintenance/${eid(id)}/complete`, opts),

  // ---- writes: owner-only CRUD on the remaining collections ----
  // Route paths use the PLURAL collection dir (vendor -> /api/vendors, etc.),
  // matching the server's COLLECTION_DIR map.
  createMaintenance: (fields: WritePayload) => postJson<MaintenanceRec>('/api/maintenance', fields),
  updateMaintenance: (id: string, patch: WritePayload) =>
    putJson<MaintenanceRec>(`/api/maintenance/${eid(id)}`, patch),
  deleteMaintenance: (id: string) => del(`/api/maintenance/${eid(id)}`),

  createInventory: (fields: WritePayload) => postJson<InventoryRec>('/api/inventory', fields),
  updateInventory: (id: string, patch: WritePayload) =>
    putJson<InventoryRec>(`/api/inventory/${eid(id)}`, patch),
  deleteInventory: (id: string) => del(`/api/inventory/${eid(id)}`),

  createVendor: (fields: WritePayload) => postJson<VendorRec>('/api/vendors', fields),
  updateVendor: (id: string, patch: WritePayload) => putJson<VendorRec>(`/api/vendors/${eid(id)}`, patch),
  deleteVendor: (id: string) => del(`/api/vendors/${eid(id)}`),

  createCost: (fields: WritePayload) => postJson<CostRec>('/api/costs', fields),
  updateCost: (id: string, patch: WritePayload) => putJson<CostRec>(`/api/costs/${eid(id)}`, patch),
  deleteCost: (id: string) => del(`/api/costs/${eid(id)}`),

  createManual: (fields: WritePayload) => postJson<ManualRec>('/api/manuals', fields),
  updateManual: (id: string, patch: WritePayload) => putJson<ManualRec>(`/api/manuals/${eid(id)}`, patch),
  deleteManual: (id: string) => del(`/api/manuals/${eid(id)}`),

  // ---- writes: photos (crew + owner) ----
  // Multipart field "photo"; the browser sets the multipart boundary, so we must
  // NOT set Content-Type ourselves. Returns { ref:'photos/<hash>.jpg' } to append
  // to a record's photos[] via a subsequent PUT.
  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.append('photo', file);
    return request<{ ref: string }>('/api/photos', { method: 'POST', body: form });
  },

  // ---- assistant (optional feature; routes exist only when enabled) ----
  assistantHistory: () => get<{ turns: AssistantTurn[] }>('/api/assistant/history'),
  assistantReset: () => del('/api/assistant/history'),
  /**
   * POST a message and receive the reply as SSE deltas via `onDelta`. We use a
   * fetch reader (EventSource is GET-only). Throws ApiError on a non-2xx or on an
   * SSE `error` event.
   */
  assistantSend: async (message: string, onDelta: (text: string) => void): Promise<void> => {
    const res = await fetch('/api/assistant/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok || !res.body) throw await parseError(res);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop() ?? '';
      for (const evt of events) {
        const lines = evt.split('\n');
        const ev = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
        const dataLine = lines.find((l) => l.startsWith('data:'))?.slice(5).trim();
        if (!dataLine) continue;
        if (ev === 'delta') onDelta(JSON.parse(dataLine) as string);
        else if (ev === 'error') throw new ApiError(502, (JSON.parse(dataLine) as { error: string }).error);
      }
    }
  },
} as const;

export type Api = typeof api;
