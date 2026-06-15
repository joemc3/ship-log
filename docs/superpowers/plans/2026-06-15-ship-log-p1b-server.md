# Ship's Log — P1b: Read Server (REST API + Auth + Redaction) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless **read server** for Ship's Log — a thin Express API that loads the P1a data layer into memory and serves it over REST, gated by the full app-level auth model (signed-cookie sessions, three roles), with **server-side cost redaction as the security core**. Read-only for data records; admin user-management and password change are included (they write the users store, not the data repo). No record writes, no git, no photos, no SPA — those are P1c/P1d/P2.

**Architecture:** `src/server/` mirrors the data layer's one-responsibility-per-file discipline and imports the data layer **only** from `src/data/index.ts`. A `createApp(deps)` factory wires Express with injected `{config, dataset, users, now}` so the whole API is driven by `supertest` in-process with no port or env. Redaction is centralized in `redactDataset(ds, role)` — a role-scoped *view* of the dataset (owner-only collections emptied, monetary fields stripped) that every read, search, and derive serves from, so a cost value can never reach a crew/guest response or the search haystack. The redactor is driven entirely by the authoritative `src/data/monetary.ts` registry — **not** the schema name-heuristic guard.

**Tech Stack:** TypeScript (ESM, Node 20+), Vitest + supertest, Express, `cookie-parser`, `express-rate-limit`, `@node-rs/argon2` (argon2id, prebuilt — no native compile), `tsx` (run TS directly), Zod (config + existing schemas).

---

## File Structure

```
ship-log/  (= repo root, /Users/joemc3/tmp/sailing)
  src/server/
    config.ts          # parse+validate env -> typed Config; decides demo-mode
    session.ts         # HMAC-signed stateless session token + cookie name
    users.ts           # users.json store: CRUD, argon2id hash/verify, bootstrap, last-owner guard
    redact.ts          # redactDataset(ds, role): role-scoped dataset view (THE security core)
    middleware.ts      # attachRole / requireAuth / requireOwner / loginLimiter
    app.ts             # createApp(deps) factory; wires middleware + route groups
    routes/
      auth.ts          # /api/welcome, /api/login, /api/logout, /api/me, /api/password
      data.ts          # /api/boat, collections, /api/costs (owner), /api/search, /api/derived
      admin.ts         # /api/users CRUD (owner only)
    index.ts           # boot: load config -> dataset -> users -> createApp -> listen (thin, untested)
  test/server/
    helpers.ts         # buildTestApp(): demo dataset + tmp users store + supertest target
    config.test.ts
    session.test.ts
    users.test.ts
    redact.test.ts
    auth.test.ts
    data.test.ts
    redaction-golden.test.ts
    admin.test.ts
    demo.test.ts
  src/data/schema.ts   # MODIFY: ISO-date refinement on date fields (carry-forward hardening)
```

Each `src/server/*.ts` has one responsibility. Route groups are split by concern (auth / data / admin) so each file stays focused. `app.ts` is the only file that knows about all three groups.

---

### Task 1: ISO-date schema hardening (data layer)

Carry-forward obligation #3: `derive.ts` silently drops malformed dates (`new Date('bad')` → Invalid Date → no task). The loader validates presence/type but not *format*. Add an ISO-date refinement so a malformed date fails loud at load instead of vanishing from a derived rollup.

**Files:**
- Modify: `src/data/schema.ts`
- Test: `test/data/schema.test.ts`

- [ ] **Step 1: Write the failing tests (append to `test/data/schema.test.ts`)**

```ts
describe('ISO-date refinement', () => {
  it('rejects a non-ISO trip date', () => {
    expect(() => tripSchema.parse({ id: 't-2024-07-01', date: 'July 1 2024' })).toThrow();
  });

  it('rejects a non-ISO maintenance due date', () => {
    expect(() => maintenanceSchema.parse({ id: 'm-x', title: 'X', status: 'due', due: '2024/06/30' })).toThrow();
  });

  it('rejects a non-ISO inventory expiry', () => {
    expect(() => inventorySchema.parse({ id: 'inv-x', name: 'Flares', expires: 'soon' })).toThrow();
  });

  it('still accepts valid ISO dates and a null completed', () => {
    expect(() => maintenanceSchema.parse({ id: 'm-x', title: 'X', status: 'done', opened: '2024-06-22', due: '2024-06-30', completed: null })).not.toThrow();
  });
});
```

`tripSchema`, `maintenanceSchema`, `inventorySchema` are already imported at the top of this test file from Tasks 4/5/8 of P1a — no new import needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- schema`
Expected: FAIL — the non-ISO values currently parse fine (`z.string()` accepts any string).

- [ ] **Step 3: Add the `isoDate` refinement and apply it (modify `src/data/schema.ts`)**

At the top of the file, just after `import { z } from 'zod';`, add:

```ts
/** A bare ISO calendar date, `YYYY-MM-DD`. Frontmatter keeps these as strings
 *  (see record.ts); this guards the *format* so derived tasks never silently
 *  drop a malformed date. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)');
```

Then swap the date fields to use it:
- In `tripSchema`: change `date: z.string(),` → `date: isoDate,`
- In `maintenanceSchema`: change `opened: z.string().optional(),` → `opened: isoDate.optional(),`; `due: z.string().optional(),` → `due: isoDate.optional(),`; `completed: z.string().nullable().optional(),` → `completed: isoDate.nullable().optional(),`
- In `costSchema`: change `date: z.string(),` → `date: isoDate,`
- In `inventorySchema`: change `inspect: z.string().optional(),  // next inspection due (ISO date)` → `inspect: isoDate.optional(),  // next inspection due (ISO date)`; same for `service` and `expires`.

- [ ] **Step 4: Run the full data suite to verify green**

Run: `npm test -- data`
Expected: PASS — the new refinement tests pass and **all existing P1a data tests still pass** (the demo fixtures and existing schema tests already use ISO dates).

- [ ] **Step 5: Commit**

```bash
git add src/data/schema.ts test/data/schema.test.ts
git commit -m "feat(data): ISO-date refinement on schema date fields (P1b carry-forward hardening)"
```

---

### Task 2: Server dependencies + config module

**Files:**
- Modify: `package.json` (deps + scripts), `.gitignore`
- Create: `src/server/config.ts`
- Test: `test/server/config.test.ts`

- [ ] **Step 1: Install dependencies and add run scripts**

```bash
cd /Users/joemc3/tmp/sailing
npm install express cookie-parser express-rate-limit @node-rs/argon2
npm install -D @types/express @types/cookie-parser supertest @types/supertest tsx
npm pkg set scripts.start="tsx src/server/index.ts"
npm pkg set scripts.dev="tsx watch src/server/index.ts"
```
Expected: deps appear in `package.json`; `@node-rs/argon2` installs prebuilt binaries (no node-gyp compile).

- [ ] **Step 2: Ignore the local users-store directory (append to `.gitignore`)**

```
var/
```
This is the default `USERS_PATH` parent (`./var/users.json`). The users store is deployment state and must never enter git.

- [ ] **Step 3: Write the failing test**

Create `test/server/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/server/config.js';

const DEMO = '/tmp/demo-placeholder';

describe('loadConfig', () => {
  it('enters demo mode when DATA_DIR is unset and uses the demo dir', () => {
    const c = loadConfig({}, DEMO);
    expect(c.demo).toBe(true);
    expect(c.dataDir).toBe(DEMO);
  });

  it('is non-demo when DATA_DIR is set, and requires SESSION_SECRET', () => {
    expect(() => loadConfig({ DATA_DIR: '/data' }, DEMO)).toThrow(/SESSION_SECRET/);
    const c = loadConfig({ DATA_DIR: '/data', SESSION_SECRET: 's' }, DEMO);
    expect(c.demo).toBe(false);
    expect(c.dataDir).toBe('/data');
    expect(c.sessionSecret).toBe('s');
  });

  it('reads owner-bootstrap when both username and password are present', () => {
    const c = loadConfig({ DATA_DIR: '/data', SESSION_SECRET: 's', OWNER_USERNAME: 'cap', OWNER_PASSWORD: 'pw' }, DEMO);
    expect(c.ownerBootstrap).toEqual({ username: 'cap', password: 'pw' });
  });

  it('defaults cookieSecure true but honors COOKIE_SECURE=false', () => {
    expect(loadConfig({ DATA_DIR: '/d', SESSION_SECRET: 's' }, DEMO).cookieSecure).toBe(true);
    expect(loadConfig({ DATA_DIR: '/d', SESSION_SECRET: 's', COOKIE_SECURE: 'false' }, DEMO).cookieSecure).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- config`
Expected: FAIL — cannot resolve `src/server/config.js`.

- [ ] **Step 5: Write the implementation**

Create `src/server/config.ts`:
```ts
import { z } from 'zod';

export interface Config {
  dataDir: string;       // resolved data directory (the demo dir when in demo mode)
  demo: boolean;         // true when no DATA_DIR was configured
  sessionSecret: string;
  usersPath: string;
  port: number;
  cookieSecure: boolean;
  sessionTtlMs: number;
  login: { windowMs: number; max: number };
  ownerBootstrap?: { username: string; password: string };
}

const envSchema = z.object({
  DATA_DIR: z.string().optional(),
  SESSION_SECRET: z.string().min(1).optional(),
  USERS_PATH: z.string().optional(),
  PORT: z.coerce.number().optional(),
  COOKIE_SECURE: z.string().optional(),
  OWNER_USERNAME: z.string().optional(),
  OWNER_PASSWORD: z.string().optional(),
});

/**
 * Build a typed Config from an env-like object. `demoDir` is the bundled demo
 * dataset path (the entry point resolves it from import.meta.url; tests pass any
 * placeholder). Demo mode = no DATA_DIR: serve the demo dataset read-only with no
 * auth. Outside demo, SESSION_SECRET is mandatory.
 */
export function loadConfig(env: NodeJS.ProcessEnv, demoDir: string): Config {
  const e = envSchema.parse(env);
  const demo = !e.DATA_DIR;
  if (!demo && !e.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required when DATA_DIR is set');
  }
  return {
    dataDir: e.DATA_DIR ?? demoDir,
    demo,
    sessionSecret: e.SESSION_SECRET ?? 'demo-ephemeral-secret',
    usersPath: e.USERS_PATH ?? './var/users.json',
    port: e.PORT ?? 8080,
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE !== 'false' : true,
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    login: { windowMs: 15 * 60 * 1000, max: 10 },
    ownerBootstrap:
      e.OWNER_USERNAME && e.OWNER_PASSWORD
        ? { username: e.OWNER_USERNAME, password: e.OWNER_PASSWORD }
        : undefined,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- config`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore src/server/config.ts test/server/config.test.ts
git commit -m "feat(server): add Express/argon2/supertest deps and config module"
```

---

### Task 3: Session module (signed stateless cookie token)

**Files:**
- Create: `src/server/session.ts`
- Test: `test/server/session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/server/session.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createToken, verifyToken, SESSION_COOKIE } from '../../src/server/session.js';

const SECRET = 'unit-test-secret';
const TTL = 1000 * 60 * 60; // 1h
const now = new Date('2024-07-01T00:00:00Z');

describe('session token', () => {
  it('round-trips a valid session', () => {
    const token = createToken({ username: 'cap', role: 'owner' }, SECRET, now);
    expect(verifyToken(token, SECRET, now, TTL)).toEqual({ username: 'cap', role: 'owner' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = createToken({ username: 'cap', role: 'owner' }, SECRET, now);
    expect(verifyToken(token, 'other-secret', now, TTL)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = createToken({ username: 'cap', role: 'crew' }, SECRET, now);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'cap', r: 'owner', iat: now.getTime() })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, SECRET, now, TTL)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = createToken({ username: 'cap', role: 'owner' }, SECRET, now);
    const later = new Date(now.getTime() + TTL + 1);
    expect(verifyToken(token, SECRET, later, TTL)).toBeNull();
  });

  it('returns null for a missing or malformed token', () => {
    expect(verifyToken(undefined, SECRET, now, TTL)).toBeNull();
    expect(verifyToken('not-a-token', SECRET, now, TTL)).toBeNull();
  });

  it('exposes the cookie name', () => {
    expect(SESSION_COOKIE).toBe('slog_session');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- session`
Expected: FAIL — cannot resolve `src/server/session.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/session.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { UserRole } from './users.js';

export const SESSION_COOKIE = 'slog_session';

export interface Session {
  username: string;
  role: UserRole;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/** Build a signed, stateless session token: `base64url(payload).hmac`. */
export function createToken(session: Session, secret: string, now: Date): string {
  const body = Buffer.from(
    JSON.stringify({ u: session.username, r: session.role, iat: now.getTime() }),
  ).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/** Verify signature, structure, and TTL. Returns the Session or null. */
export function verifyToken(
  token: string | undefined,
  secret: string,
  now: Date,
  ttlMs: number,
): Session | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: { u?: unknown; r?: unknown; iat?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    typeof parsed.u !== 'string' ||
    (parsed.r !== 'owner' && parsed.r !== 'crew') ||
    typeof parsed.iat !== 'number'
  ) {
    return null;
  }
  if (now.getTime() - parsed.iat > ttlMs) return null;
  return { username: parsed.u, role: parsed.r };
}
```

Note: `session.ts` imports the `UserRole` *type* from `users.js` (Task 4). Type-only imports don't create a runtime cycle, but write Task 4 before running the typecheck in later tasks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- session`
Expected: PASS (6 tests). Vitest resolves the type-only import without `users.ts` existing yet at runtime; if your editor flags the missing module, that clears once Task 4 lands.

- [ ] **Step 5: Commit**

```bash
git add src/server/session.ts test/server/session.test.ts
git commit -m "feat(server): HMAC-signed stateless session token"
```

---

### Task 4: Users store (argon2id) + bootstrap + last-owner guard

**Files:**
- Create: `src/server/users.ts`
- Test: `test/server/users.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/server/users.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsersStore } from '../../src/server/users.js';

function tmpUsersPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
}

describe('UsersStore', () => {
  let path: string;
  beforeEach(() => { path = tmpUsersPath(); });

  it('starts empty and bootstraps a single owner', async () => {
    const store = await UsersStore.load(path);
    expect(store.isEmpty()).toBe(true);
    await store.bootstrapOwner('cap', 'ownerpass123');
    expect(store.isEmpty()).toBe(false);
    expect(store.list()).toEqual([{ username: 'cap', role: 'owner' }]);
  });

  it('bootstrap is a no-op once a user exists', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    await store.bootstrapOwner('intruder', 'x');
    expect(store.list().map((u) => u.username)).toEqual(['cap']);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    expect(await store.verify('cap', 'ownerpass123')).toEqual({ username: 'cap', role: 'owner' });
    expect(await store.verify('cap', 'wrong')).toBeNull();
    expect(await store.verify('ghost', 'whatever')).toBeNull();
  });

  it('never exposes the password hash via list()', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    expect(JSON.stringify(store.list())).not.toMatch(/argon2|\$/);
  });

  it('changePassword requires the correct current password', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    await expect(store.changePassword('cap', 'wrong', 'newpass123')).rejects.toThrow();
    await store.changePassword('cap', 'ownerpass123', 'newpass123');
    expect(await store.verify('cap', 'newpass123')).not.toBeNull();
  });

  it('guards the last owner against deletion and demotion', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    await store.add('deck', 'crewpass123', 'crew');
    await expect(store.remove('cap')).rejects.toThrow(/last owner/);
    await expect(store.setRole('cap', 'crew')).rejects.toThrow(/last owner/);
    await store.add('mate', 'ownerpass123', 'owner');
    await store.remove('cap'); // now allowed — another owner remains
    expect(store.ownerCount()).toBe(1);
  });

  it('persists across reloads', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    const reloaded = await UsersStore.load(path);
    expect(await reloaded.verify('cap', 'ownerpass123')).toEqual({ username: 'cap', role: 'owner' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- users`
Expected: FAIL — cannot resolve `src/server/users.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/users.ts`:
```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hash, verify } from '@node-rs/argon2';

export type UserRole = 'owner' | 'crew';
export interface UserRecord { username: string; role: UserRole; hash: string; }
export interface PublicUser { username: string; role: UserRole; }

/**
 * File-backed users store (a small `users.json` of hashed credentials). Lives in
 * a VPS volume OUTSIDE the git data repo. Passwords are argon2id-hashed
 * (@node-rs/argon2's default variant) and never returned or logged.
 */
export class UsersStore {
  private constructor(
    private readonly path: string,
    private readonly users: Map<string, UserRecord>,
  ) {}

  static async load(path: string): Promise<UsersStore> {
    let users = new Map<string, UserRecord>();
    try {
      const arr = JSON.parse(await readFile(path, 'utf8')) as UserRecord[];
      users = new Map(arr.map((u) => [u.username, u]));
    } catch (err) {
      // A missing file = an empty store (first boot). Anything else is real.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return new UsersStore(path, users);
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify([...this.users.values()], null, 2));
  }

  isEmpty(): boolean { return this.users.size === 0; }
  ownerCount(): number { return [...this.users.values()].filter((u) => u.role === 'owner').length; }
  list(): PublicUser[] { return [...this.users.values()].map(({ username, role }) => ({ username, role })); }
  get(username: string): UserRecord | undefined { return this.users.get(username); }

  async verify(username: string, password: string): Promise<PublicUser | null> {
    const u = this.users.get(username);
    if (!u) return null;
    if (!(await verify(u.hash, password))) return null;
    return { username: u.username, role: u.role };
  }

  async add(username: string, password: string, role: UserRole): Promise<void> {
    if (this.users.has(username)) throw new Error(`user already exists: ${username}`);
    this.users.set(username, { username, role, hash: await hash(password) });
    await this.persist();
  }

  async setPassword(username: string, password: string): Promise<void> {
    const u = this.users.get(username);
    if (!u) throw new Error(`no such user: ${username}`);
    u.hash = await hash(password);
    await this.persist();
  }

  async setRole(username: string, role: UserRole): Promise<void> {
    const u = this.users.get(username);
    if (!u) throw new Error(`no such user: ${username}`);
    if (u.role === 'owner' && role !== 'owner' && this.ownerCount() === 1) {
      throw new Error('cannot demote the last owner');
    }
    u.role = role;
    await this.persist();
  }

  async remove(username: string): Promise<void> {
    const u = this.users.get(username);
    if (!u) return;
    if (u.role === 'owner' && this.ownerCount() === 1) {
      throw new Error('cannot delete the last owner');
    }
    this.users.delete(username);
    await this.persist();
  }

  async changePassword(username: string, current: string, next: string): Promise<void> {
    const u = this.users.get(username);
    if (!u || !(await verify(u.hash, current))) throw new Error('invalid current password');
    u.hash = await hash(next);
    await this.persist();
  }

  async bootstrapOwner(username: string, password: string): Promise<void> {
    if (!this.isEmpty()) return;
    await this.add(username, password, 'owner');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- users`
Expected: PASS (7 tests). (argon2 hashing makes these a touch slower than pure-logic tests — that's expected.)

- [ ] **Step 5: Commit**

```bash
git add src/server/users.ts test/server/users.test.ts
git commit -m "feat(server): argon2id users store with bootstrap and last-owner guard"
```

---

### Task 5: Redaction core (`redactDataset`)

The security core. `redactDataset(ds, role)` returns a role-scoped **view**: owners get the dataset unchanged; crew/guest get a deep copy with owner-only collections emptied and every monetary field deleted. Every read/search/derive route serves from this view, so a cost value cannot reach a non-owner response or the search haystack. Driven entirely by `src/data/monetary.ts` (carry-forward #1 + #2).

**Files:**
- Create: `src/server/redact.ts`
- Test: `test/server/redact.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/server/redact.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadDataset } from '../../src/data/index.js';
import { redactDataset } from '../../src/server/redact.js';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');

describe('redactDataset', () => {
  it('returns the same dataset reference for an owner (no copy)', async () => {
    const ds = await loadDataset(DEMO);
    expect(redactDataset(ds, 'owner')).toBe(ds);
  });

  it('empties owner-only collections and strips monetary fields for crew', async () => {
    const ds = await loadDataset(DEMO);
    const view = redactDataset(ds, 'crew');
    expect(view.costs).toEqual([]);
    expect(view.maintenance.every((m) => !('costEst' in m))).toBe(true);
  });

  it('treats guest the same as crew', async () => {
    const ds = await loadDataset(DEMO);
    const view = redactDataset(ds, 'guest');
    expect(view.costs).toEqual([]);
    expect(view.maintenance.every((m) => !('costEst' in m))).toBe(true);
  });

  it('does not mutate the original dataset', async () => {
    const ds = await loadDataset(DEMO);
    redactDataset(ds, 'crew');
    expect(ds.costs.length).toBeGreaterThan(0);
    expect(ds.maintenance.some((m) => 'costEst' in m)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- redact`
Expected: FAIL — cannot resolve `src/server/redact.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/redact.ts`:
```ts
import type { Dataset } from '../data/index.js';
import { MONETARY_FIELDS, OWNER_ONLY_COLLECTIONS } from '../data/index.js';

export type Role = 'owner' | 'crew' | 'guest';

// Map a monetary-registry collection key (singular) to its Dataset array property.
const DATASET_KEY: Record<string, keyof Dataset> = {
  trip: 'trips',
  maintenance: 'maintenance',
  cost: 'costs',
  vendor: 'vendors',
  inventory: 'inventory',
  manual: 'manuals',
};

/**
 * Return a role-scoped VIEW of the dataset. Owners get the original reference;
 * crew/guest get a deep copy with owner-only collections emptied and every
 * monetary field stripped — so the value never reaches a response, the search
 * haystack, or a derived rollup. Authoritative source: src/data/monetary.ts.
 */
export function redactDataset(ds: Dataset, role: Role): Dataset {
  if (role === 'owner') return ds;
  const view = structuredClone(ds);

  for (const collection of OWNER_ONLY_COLLECTIONS) {
    const key = DATASET_KEY[collection];
    if (key && Array.isArray(view[key])) (view[key] as unknown[]).length = 0;
  }

  for (const [collection, fields] of Object.entries(MONETARY_FIELDS)) {
    if ((OWNER_ONLY_COLLECTIONS as readonly string[]).includes(collection)) continue;
    const key = DATASET_KEY[collection];
    if (!key) continue;
    for (const record of view[key] as Array<Record<string, unknown>>) {
      for (const f of fields) delete record[f];
    }
  }
  return view;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- redact`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/redact.ts test/server/redact.test.ts
git commit -m "feat(server): redactDataset — role-scoped dataset view (cost-redaction core)"
```

---

### Task 6: App factory + auth middleware + auth routes

Builds the Express app and the auth surface: `GET /api/welcome` (public), `POST /api/login`, `POST /api/logout`, `GET /api/me`, `POST /api/password`. Establishes the `createApp(deps)` factory and the shared supertest helper that all later route tasks reuse.

**Files:**
- Create: `src/server/middleware.ts`, `src/server/app.ts`, `src/server/routes/auth.ts`, `test/server/helpers.ts`
- Test: `test/server/auth.test.ts`

- [ ] **Step 1: Write the shared test helper**

Create `test/server/helpers.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Express } from 'express';
import { loadConfig, type Config } from '../../src/server/config.js';
import { loadDataset } from '../../src/data/index.js';
import { UsersStore } from '../../src/server/users.js';
import { createApp } from '../../src/server/app.js';

export const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');
export const FIXED_NOW = () => new Date('2024-07-01T00:00:00Z');

export interface TestApp { app: Express; users: UsersStore; config: Config; }

/**
 * Build an app over the demo dataset. Default = authenticated (non-demo) mode
 * with a seeded owner1/crew1; pass { demo: true } for the no-auth demo path.
 */
export async function buildTestApp(opts: { demo?: boolean } = {}): Promise<TestApp> {
  const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
  const env = opts.demo
    ? { USERS_PATH: usersPath }
    : { DATA_DIR: DEMO, SESSION_SECRET: 'test-secret', COOKIE_SECURE: 'false', USERS_PATH: usersPath };
  const config = loadConfig(env, DEMO);
  const dataset = await loadDataset(config.dataDir);
  const users = await UsersStore.load(usersPath);
  if (!opts.demo) {
    await users.add('owner1', 'ownerpass123', 'owner');
    await users.add('crew1', 'crewpass123', 'crew');
  }
  const app = createApp({ config, dataset, users, now: FIXED_NOW });
  return { app, users, config };
}
```

- [ ] **Step 2: Write the failing test**

Create `test/server/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers.js';

describe('auth routes', () => {
  it('serves public welcome content without auth', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/api/welcome');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Valkyrie');
    expect(res.body.welcome.rules).toBeTruthy();
    // welcome must NOT leak full collections
    expect(res.body.trips).toBeUndefined();
  });

  it('reports guest for an unauthenticated /api/me', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/api/me');
    expect(res.body).toMatchObject({ role: 'guest', demo: false, ownerConfigured: true });
  });

  it('logs in, reports identity, and logs out', async () => {
    const { app } = await buildTestApp();
    const agent = request.agent(app);
    const login = await agent.post('/api/login').send({ username: 'owner1', password: 'ownerpass123' });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ username: 'owner1', role: 'owner' });

    const me = await agent.get('/api/me');
    expect(me.body).toMatchObject({ username: 'owner1', role: 'owner' });

    await agent.post('/api/logout').expect(204);
    const after = await agent.get('/api/me');
    expect(after.body.role).toBe('guest');
  });

  it('returns a generic 401 for bad credentials (no user enumeration)', async () => {
    const { app } = await buildTestApp();
    const wrongPw = await request(app).post('/api/login').send({ username: 'owner1', password: 'nope' });
    const noUser = await request(app).post('/api/login').send({ username: 'ghost', password: 'nope' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body);
  });

  it('lets a logged-in user change their own password', async () => {
    const { app } = await buildTestApp();
    const agent = request.agent(app);
    await agent.post('/api/login').send({ username: 'crew1', password: 'crewpass123' });
    await agent.post('/api/password').send({ currentPassword: 'crewpass123', newPassword: 'crewpass456' }).expect(204);
    await agent.post('/api/password').send({ currentPassword: 'wrong', newPassword: 'x'.repeat(8) }).expect(400);
  });

  it('rate-limits repeated login attempts', async () => {
    const { app, config } = await buildTestApp();
    config.login.max = 3; // tighten for this test (Config is a plain object)
    let last = 0;
    for (let i = 0; i < 5; i++) {
      last = (await request(app).post('/api/login').send({ username: 'owner1', password: 'nope' })).status;
    }
    expect(last).toBe(429);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- auth`
Expected: FAIL — cannot resolve `src/server/app.js` / `middleware.js` / `routes/auth.js`.

- [ ] **Step 4: Write the middleware**

Create `src/server/middleware.ts`:
```ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { verifyToken, SESSION_COOKIE, type Session } from './session.js';
import type { Role } from './redact.js';
import type { Config } from './config.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      viewer: { role: Role; username: string | null };
    }
  }
}

/** Resolve the requester's role: demo => owner; valid cookie => its role; else guest. */
export function attachRole(config: Config, now: () => Date): RequestHandler {
  return (req, _res, next) => {
    if (config.demo) {
      req.viewer = { role: 'owner', username: null };
      return next();
    }
    const session: Session | null = verifyToken(
      req.cookies?.[SESSION_COOKIE],
      config.sessionSecret,
      now(),
      config.sessionTtlMs,
    );
    req.viewer = session
      ? { role: session.role, username: session.username }
      : { role: 'guest', username: null };
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.viewer.role === 'guest') {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.viewer.role !== 'owner') {
    res.status(403).json({ error: 'owner only' });
    return;
  }
  next();
}

export function loginLimiter(config: Config): RequestHandler {
  return rateLimit({
    windowMs: config.login.windowMs,
    limit: () => config.login.max, // a function, read live, so a test can tighten the limit after the app is built
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
}
```

Note: `limit` is a function (express-rate-limit v7 supports this) so it reads `config.login.max` on every request. That's what lets the rate-limit test in Step 2 set `config.login.max = 3` *after* `buildTestApp()` and have it take effect.

- [ ] **Step 5: Write the auth routes**

Create `src/server/routes/auth.ts`:
```ts
import type { Express } from 'express';
import type { AppContext } from '../app.js';
import { createToken, SESSION_COOKIE } from '../session.js';
import { requireAuth, loginLimiter } from '../middleware.js';

export function registerAuthRoutes(app: Express, ctx: AppContext): void {
  const { config, dataset, users, now } = ctx;

  // Public: boat identity + welcome block ONLY (guest-visible). No collections.
  app.get('/api/welcome', (_req, res) => {
    const { name, make, model, year, hailingPort, welcome } = dataset.boat;
    res.json({ name, make, model, year, hailingPort, welcome: welcome ?? {} });
  });

  app.get('/api/me', (req, res) => {
    res.json({
      role: req.viewer.role,
      username: req.viewer.username,
      demo: config.demo,
      ownerConfigured: !users.isEmpty(),
    });
  });

  app.post('/api/login', loginLimiter(config), async (req, res) => {
    if (config.demo) { res.status(400).json({ error: 'login disabled in demo mode' }); return; }
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'username and password required' });
      return;
    }
    const user = await users.verify(username, password);
    if (!user) { res.status(401).json({ error: 'invalid credentials' }); return; }
    const token = createToken({ username: user.username, role: user.role }, config.sessionSecret, now());
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: config.sessionTtlMs,
    });
    res.json({ username: user.username, role: user.role });
  });

  app.post('/api/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  app.post('/api/password', requireAuth, async (req, res) => {
    if (config.demo) { res.status(400).json({ error: 'disabled in demo mode' }); return; }
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
      res.status(400).json({ error: 'currentPassword and newPassword (min 8 chars) required' });
      return;
    }
    try {
      await users.changePassword(req.viewer.username!, currentPassword, newPassword);
    } catch {
      res.status(400).json({ error: 'invalid current password' });
      return;
    }
    res.status(204).end();
  });
}
```

- [ ] **Step 6: Write the app factory**

Create `src/server/app.ts`:
```ts
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { Dataset } from '../data/index.js';
import type { Config } from './config.js';
import type { UsersStore } from './users.js';
import { attachRole } from './middleware.js';
import { registerAuthRoutes } from './routes/auth.js';

export interface AppContext {
  config: Config;
  dataset: Dataset;
  users: UsersStore;
  now: () => Date;
}

/** Build the Express app from injected deps. `now` defaults to the real clock;
 *  tests inject a fixed clock so derived views are deterministic. */
export function createApp(deps: Omit<AppContext, 'now'> & { now?: () => Date }): Express {
  const ctx: AppContext = { ...deps, now: deps.now ?? (() => new Date()) };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachRole(ctx.config, ctx.now));
  registerAuthRoutes(app, ctx);
  return app;
}
```

- [ ] **Step 7: Run test to verify it passes, and typecheck**

Run: `npm test -- auth && npm run typecheck`
Expected: PASS (6 tests); `tsc --noEmit` reports no errors (the `Express.Request.viewer` augmentation now resolves).

- [ ] **Step 8: Commit**

```bash
git add src/server/middleware.ts src/server/app.ts src/server/routes/auth.ts test/server/helpers.ts test/server/auth.test.ts
git commit -m "feat(server): createApp factory, auth middleware, and auth routes"
```

---

### Task 7: Data read routes + role gating + redaction

Adds the read API for every collection, the owner-only costs endpoint (403 for crew), search, and derived views — all served through `redactDataset`.

**Files:**
- Create: `src/server/routes/data.ts`
- Modify: `src/server/app.ts` (wire the data routes)
- Test: `test/server/data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/server/data.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers.js';

async function agentFor(role: 'owner' | 'crew') {
  const { app } = await buildTestApp();
  const agent = request.agent(app);
  await agent.post('/api/login').send({
    username: role === 'owner' ? 'owner1' : 'crew1',
    password: role === 'owner' ? 'ownerpass123' : 'crewpass123',
  });
  return agent;
}

describe('data routes', () => {
  it('requires auth for collections', async () => {
    const { app } = await buildTestApp();
    await request(app).get('/api/trips').expect(401);
    await request(app).get('/api/maintenance').expect(401);
  });

  it('serves collections to an authenticated crew member', async () => {
    const agent = await agentFor('crew');
    const trips = await agent.get('/api/trips');
    expect(trips.status).toBe(200);
    expect(trips.body.map((t: { id: string }) => t.id)).toContain('t-2024-06-22');
    const one = await agent.get('/api/trips/t-2024-06-22');
    expect(one.body.id).toBe('t-2024-06-22');
    await agent.get('/api/trips/t-nope').expect(404);
  });

  it('strips costEst from maintenance for crew but keeps it for owner', async () => {
    const crew = await agentFor('crew');
    const owner = await agentFor('owner');
    const mCrew = (await crew.get('/api/maintenance')).body.find((m: { id: string }) => m.id === 'm-jib-halyard');
    const mOwner = (await owner.get('/api/maintenance')).body.find((m: { id: string }) => m.id === 'm-jib-halyard');
    expect('costEst' in mCrew).toBe(false);
    expect(mOwner.costEst).toBe(95);
  });

  it('gates the costs collection to owners (403 for crew)', async () => {
    const crew = await agentFor('crew');
    const owner = await agentFor('owner');
    await crew.get('/api/costs').expect(403);
    const ownerCosts = await owner.get('/api/costs');
    expect(ownerCosts.status).toBe(200);
    expect(ownerCosts.body.map((c: { id: string }) => c.id)).toContain('c-jib-halyard');
  });

  it('computes derived views with the injected clock', async () => {
    const crew = await agentFor('crew');
    const res = await crew.get('/api/derived');
    // FIXED_NOW = 2024-07-01: expired flares (overdue) + soon-due fire-ext (due) = 2
    expect(res.body.attention).toBe(2);
    expect(res.body.inventoryTasks).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- data`
Expected: FAIL — `/api/trips` 404s (route not registered) so the first assertion (`expect(401)`) fails.

- [ ] **Step 3: Write the data routes**

Create `src/server/routes/data.ts`:
```ts
import type { Express, Request } from 'express';
import type { AppContext } from '../app.js';
import { requireAuth, requireOwner } from '../middleware.js';
import { redactDataset } from '../redact.js';
import { search as searchData, deriveInventoryTasks, deriveAttention } from '../../data/index.js';

export function registerDataRoutes(app: Express, ctx: AppContext): void {
  const { dataset, now } = ctx;
  const view = (req: Request) => redactDataset(dataset, req.viewer.role);

  app.get('/api/boat', requireAuth, (req, res) => res.json(view(req).boat));

  app.get('/api/trips', requireAuth, (req, res) => res.json(view(req).trips));
  app.get('/api/trips/:id', requireAuth, (req, res) => {
    const t = view(req).trips.find((x) => x.id === req.params.id);
    if (t) res.json(t); else res.status(404).json({ error: 'not found' });
  });

  app.get('/api/maintenance', requireAuth, (req, res) => res.json(view(req).maintenance));
  app.get('/api/maintenance/:id', requireAuth, (req, res) => {
    const m = view(req).maintenance.find((x) => x.id === req.params.id);
    if (m) res.json(m); else res.status(404).json({ error: 'not found' });
  });

  app.get('/api/inventory', requireAuth, (req, res) => res.json(view(req).inventory));
  app.get('/api/vendors', requireAuth, (req, res) => res.json(view(req).vendors));
  app.get('/api/manuals', requireAuth, (req, res) => res.json(view(req).manuals));
  app.get('/api/quickref', requireAuth, (req, res) => res.json(view(req).quickref));

  // Owner-only collection. requireOwner => 403 for crew/guest.
  app.get('/api/costs', requireOwner, (_req, res) => res.json(dataset.costs));
  app.get('/api/costs/:id', requireOwner, (req, res) => {
    const c = dataset.costs.find((x) => x.id === req.params.id);
    if (c) res.json(c); else res.status(404).json({ error: 'not found' });
  });

  app.get('/api/search', requireAuth, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(searchData(view(req), q)); // search over the redacted view: no cost hits, no monetary values
  });

  app.get('/api/derived', requireAuth, (req, res) => {
    const v = view(req);
    const clock = now();
    res.json({ attention: deriveAttention(v, clock), inventoryTasks: deriveInventoryTasks(v, clock) });
  });
}
```

- [ ] **Step 4: Wire the data routes into the app (modify `src/server/app.ts`)**

Add the import beside the auth-routes import:
```ts
import { registerDataRoutes } from './routes/data.js';
```
And call it right after `registerAuthRoutes(app, ctx);`:
```ts
  registerAuthRoutes(app, ctx);
  registerDataRoutes(app, ctx);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- data`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/data.ts src/server/app.ts test/server/data.test.ts
git commit -m "feat(server): redacted read routes, owner-only costs, search, derived views"
```

---

### Task 8: The cost-redaction golden test

The spec's required guard: deep-walk **every** crew and guest response across **every** endpoint and assert no monetary key and no owner-only record ever appears. This is the regression net that makes redaction provably server-side.

**Files:**
- Test: `test/server/redaction-golden.test.ts`

- [ ] **Step 1: Write the golden test**

Create `test/server/redaction-golden.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers.js';
import { MONETARY_FIELDS } from '../../src/data/index.js';

const MONETARY_KEYS = new Set(Object.values(MONETARY_FIELDS).flat()); // costEst, amount

function assertNoMonetaryKey(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoMonetaryKey(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      expect(MONETARY_KEYS.has(k), `monetary key "${k}" leaked at ${path}`).toBe(false);
      assertNoMonetaryKey(v, `${path}.${k}`);
    }
  }
}

const CREW_ENDPOINTS = [
  '/api/boat', '/api/trips', '/api/maintenance', '/api/inventory',
  '/api/vendors', '/api/manuals', '/api/quickref', '/api/derived',
  '/api/search?q=halyard', '/api/search?q=92.5',
];

describe('cost-redaction golden test', () => {
  it('no monetary key appears in any crew response, and costs are 403', async () => {
    const { app } = await buildTestApp();
    const agent = request.agent(app);
    await agent.post('/api/login').send({ username: 'crew1', password: 'crewpass123' });

    for (const ep of CREW_ENDPOINTS) {
      const res = await agent.get(ep);
      expect(res.status, `${ep} should be readable by crew`).toBe(200);
      assertNoMonetaryKey(res.body, ep);
    }
    await agent.get('/api/costs').expect(403);
    await agent.get('/api/costs/c-jib-halyard').expect(403);
  });

  it('crew search never returns a cost-collection hit', async () => {
    const { app } = await buildTestApp();
    const agent = request.agent(app);
    await agent.post('/api/login').send({ username: 'crew1', password: 'crewpass123' });
    // "92.5" is the demo cost amount; a crew search must not surface the cost record.
    const byAmount = await agent.get('/api/search?q=92.5');
    expect(byAmount.body.some((h: { collection: string }) => h.collection === 'cost')).toBe(false);
    const byWord = await agent.get('/api/search?q=halyard');
    expect(byWord.body.some((h: { collection: string }) => h.collection === 'cost')).toBe(false);
  });

  it('a guest gets no collection data at all (only welcome + me)', async () => {
    const { app } = await buildTestApp();
    for (const ep of CREW_ENDPOINTS) {
      await request(app).get(ep).expect(401);
    }
    await request(app).get('/api/costs').expect(403);
    await request(app).get('/api/welcome').expect(200);
  });
});
```

- [ ] **Step 2: Run the golden test**

Run: `npm test -- redaction-golden`
Expected: PASS (3 tests). If any assertion fails, the redactor or a route is leaking — fix the leak, do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add test/server/redaction-golden.test.ts
git commit -m "test(server): cost-redaction golden test across all endpoints"
```

---

### Task 9: Admin user-management routes (owner only)

**Files:**
- Create: `src/server/routes/admin.ts`
- Modify: `src/server/app.ts` (wire the admin routes)
- Test: `test/server/admin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/server/admin.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers.js';

async function ownerAgent() {
  const { app, users } = await buildTestApp();
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username: 'owner1', password: 'ownerpass123' });
  return { agent, users, app };
}

describe('admin routes', () => {
  it('lists users for an owner (never hashes)', async () => {
    const { agent } = await ownerAgent();
    const res = await agent.get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toContainEqual({ username: 'owner1', role: 'owner' });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|argon2/i);
  });

  it('forbids admin endpoints to crew', async () => {
    const { app } = await buildTestApp();
    const crew = request.agent(app);
    await crew.post('/api/login').send({ username: 'crew1', password: 'crewpass123' });
    await crew.get('/api/users').expect(403);
    await crew.post('/api/users').send({ username: 'x', password: 'y'.repeat(8), role: 'crew' }).expect(403);
  });

  it('adds, updates the role of, and deletes a user', async () => {
    const { agent } = await ownerAgent();
    await agent.post('/api/users').send({ username: 'newcrew', password: 'newpass123', role: 'crew' }).expect(201);
    await agent.post('/api/users').send({ username: 'newcrew', password: 'newpass123', role: 'crew' }).expect(409);
    await agent.put('/api/users/newcrew').send({ role: 'owner' }).expect(204);
    const list = await agent.get('/api/users');
    expect(list.body).toContainEqual({ username: 'newcrew', role: 'owner' });
    await agent.delete('/api/users/newcrew').expect(204);
  });

  it('rejects bad input and unknown targets', async () => {
    const { agent } = await ownerAgent();
    await agent.post('/api/users').send({ username: 'short', password: 'tiny', role: 'crew' }).expect(400);
    await agent.post('/api/users').send({ username: 'bad', password: 'longenough', role: 'admiral' }).expect(400);
    await agent.put('/api/users/ghost').send({ role: 'crew' }).expect(404);
  });

  it('protects the last owner from deletion', async () => {
    const { agent } = await ownerAgent();
    await agent.delete('/api/users/owner1').expect(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- admin`
Expected: FAIL — `/api/users` 404s (not registered), so `expect(200)` fails.

- [ ] **Step 3: Write the admin routes**

Create `src/server/routes/admin.ts`:
```ts
import type { Express } from 'express';
import type { AppContext } from '../app.js';
import { requireOwner } from '../middleware.js';
import type { UserRole } from '../users.js';

function validRole(r: unknown): r is UserRole {
  return r === 'owner' || r === 'crew';
}

export function registerAdminRoutes(app: Express, ctx: AppContext): void {
  const { users } = ctx;

  app.get('/api/users', requireOwner, (_req, res) => res.json(users.list()));

  app.post('/api/users', requireOwner, async (req, res) => {
    const { username, password, role } = req.body ?? {};
    if (typeof username !== 'string' || username.length < 1 ||
        typeof password !== 'string' || password.length < 8 || !validRole(role)) {
      res.status(400).json({ error: 'username, password (min 8 chars), role (owner|crew) required' });
      return;
    }
    try {
      await users.add(username, password, role);
    } catch {
      res.status(409).json({ error: 'user already exists' });
      return;
    }
    res.status(201).json({ username, role });
  });

  app.put('/api/users/:username', requireOwner, async (req, res) => {
    const target = req.params.username;
    if (!users.get(target)) { res.status(404).json({ error: 'no such user' }); return; }
    const { role, password } = req.body ?? {};
    try {
      if (role !== undefined) {
        if (!validRole(role)) { res.status(400).json({ error: 'role must be owner|crew' }); return; }
        await users.setRole(target, role);
      }
      if (password !== undefined) {
        if (typeof password !== 'string' || password.length < 8) {
          res.status(400).json({ error: 'password must be at least 8 chars' });
          return;
        }
        await users.setPassword(target, password);
      }
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
      return;
    }
    res.status(204).end();
  });

  app.delete('/api/users/:username', requireOwner, async (req, res) => {
    try {
      await users.remove(req.params.username);
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
      return;
    }
    res.status(204).end();
  });
}
```

- [ ] **Step 4: Wire the admin routes into the app (modify `src/server/app.ts`)**

Add the import:
```ts
import { registerAdminRoutes } from './routes/admin.js';
```
And call it after the data routes:
```ts
  registerDataRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- admin`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/admin.ts src/server/app.ts test/server/admin.test.ts
git commit -m "feat(server): owner-only admin user-management routes"
```

---

### Task 10: Entry point + demo mode + docs refresh + full green run

**Files:**
- Create: `src/server/index.ts`
- Test: `test/server/demo.test.ts`
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Write the failing demo-mode test**

Create `test/server/demo.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers.js';

describe('demo mode', () => {
  it('serves everything as owner with no auth, and flags demo', async () => {
    const { app } = await buildTestApp({ demo: true });
    const me = await request(app).get('/api/me');
    expect(me.body).toMatchObject({ role: 'owner', demo: true });

    // Costs visible without logging in (sample numbers in the demo dataset).
    const costs = await request(app).get('/api/costs');
    expect(costs.status).toBe(200);
    expect(costs.body.map((c: { id: string }) => c.id)).toContain('c-jib-halyard');

    // Monetary fields present for the (owner-equivalent) demo viewer.
    const maint = (await request(app).get('/api/maintenance')).body.find((m: { id: string }) => m.id === 'm-jib-halyard');
    expect(maint.costEst).toBe(95);
  });

  it('disables login in demo mode', async () => {
    const { app } = await buildTestApp({ demo: true });
    await request(app).post('/api/login').send({ username: 'x', password: 'y' }).expect(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- demo`
Expected: FAIL — until verified, confirm the assertions describe demo behavior. (If `attachRole`/routes already satisfy this from earlier tasks, this test may pass immediately — that's fine; it locks the behavior in. If it fails, fix the demo branch in `attachRole` / auth routes.)

- [ ] **Step 3: Write the entry point**

Create `src/server/index.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { loadDataset } from '../data/index.js';
import { UsersStore } from './users.js';
import { createApp } from './app.js';

const demoDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');

async function main(): Promise<void> {
  const config = loadConfig(process.env, demoDir);
  const dataset = await loadDataset(config.dataDir);
  const users = await UsersStore.load(config.usersPath);

  if (config.ownerBootstrap && users.isEmpty()) {
    await users.bootstrapOwner(config.ownerBootstrap.username, config.ownerBootstrap.password);
    console.log(`Bootstrapped owner "${config.ownerBootstrap.username}".`);
  }
  if (!config.demo && users.isEmpty()) {
    console.warn('No owner configured: the gated area is locked until OWNER_USERNAME/OWNER_PASSWORD seed one.');
  }

  createApp({ config, dataset, users }).listen(config.port, () => {
    console.log(`Ship's Log server listening on :${config.port}${config.demo ? ' (DEMO MODE)' : ''}`);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 4: Run the demo test and the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: ALL tests PASS (data layer + every server suite); `tsc --noEmit` clean.

- [ ] **Step 5: Smoke-test the running server (manual, optional but recommended)**

```bash
npm start &       # boots in DEMO mode (no DATA_DIR)
sleep 1
curl -s localhost:8080/api/me            # => {"role":"owner","username":null,"demo":true,...}
curl -s localhost:8080/api/costs | head  # => demo cost rows (visible in demo)
kill %1
```
Expected: demo responses as above.

- [ ] **Step 6: Update `README.md`**

Replace the `## Status` section body with:
```markdown
In development. The data core (P1a) and the read server (P1b) are built: a
headless data layer (`src/data/`) plus an Express REST API (`src/server/`) with
app-level auth (signed-cookie sessions, three roles) and server-side cost
redaction. Record writes, git sync, photos, and the SPA follow in later plans.
```

Add a `## Run the server` section after `## Develop`:
```markdown
## Run the server

```bash
npm start          # production-style boot (tsx)
npm run dev        # watch mode
```

With no `DATA_DIR` the server runs in **demo mode**: it serves the bundled
`demo/` dataset read-only, with no auth and costs visible, clearly flagged via
`GET /api/me` (`demo: true`).

Environment:

- `DATA_DIR` — path to the data working clone. Unset ⇒ demo mode.
- `SESSION_SECRET` — required outside demo; signs session cookies.
- `OWNER_USERNAME` / `OWNER_PASSWORD` — seed the first owner on an empty store.
- `USERS_PATH` — users store location (default `./var/users.json`; **never** in
  the data repo; gitignored).
- `PORT` (default 8080), `COOKIE_SECURE` (default true; set `false` for local http).
```

Update the `## Layout` section: add a bullet under `src/data/`:
```markdown
- `src/server/` — the read server: `config`, `session`, `users` (argon2id store),
  `redact` (role-scoped dataset view), `middleware`, `routes/` (auth, data,
  admin), `app` (`createApp` factory), `index` (boot). Imports the data layer
  only from `src/data/index.ts`.
```

- [ ] **Step 7: Update `CLAUDE.md`**

Append a new section after the existing security-invariant section:
```markdown
## Server layer (P1b)

- `src/server/` is the read API: one responsibility per file; it imports the data
  layer **only** from `src/data/index.ts`. The app is a `createApp(deps)` factory
  with injected `{config, dataset, users, now}` — tests drive it via `supertest`
  in-process; `now` is injected so derived views stay deterministic.
- Auth: argon2id password hashing (`@node-rs/argon2`) + stateless HMAC-signed
  HTTP-only session cookies (`SESSION_SECRET`). The users store (`users.json`) is
  deployment state in a VPS volume — **never** committed to the data repo.
- **Redaction is enforced server-side by `src/server/redact.ts`** via
  `redactDataset(ds, role)`, driven by the `monetary.ts` registry (NOT the schema
  name-heuristic). Every read/search/derive route serves the role-scoped view, so
  monetary values never reach a crew/guest response or the search haystack. The
  `redaction-golden` test deep-walks every non-owner response and asserts no
  monetary key (and no owner-only record) ever appears — keep it passing; never
  weaken it.
- Demo mode (no `DATA_DIR`): every request is owner-equivalent and read-only,
  flagged via `GET /api/me`; login/writes are disabled.
```

Also update the existing security-invariant section's last line to point at the enforcement: change the sentence that begins "The set of monetary fields lives in `src/data/monetary.ts` ..." to add: "and is enforced at the response boundary by `src/server/redact.ts` (`redactDataset`), guarded by the `redaction-golden` test."

- [ ] **Step 8: Final full green run**

Run: `npm test && npm run typecheck`
Expected: ALL PASS; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add src/server/index.ts test/server/demo.test.ts README.md CLAUDE.md
git commit -m "feat(server): entry point + demo mode; refresh README + CLAUDE.md for P1b"
```

---

## Self-Review

**Spec coverage (P1b slice — the "REST API" + "Auth layer" + "Users store" + server-side redaction from the design spec):**
- REST `GET` collections/records, role-filtered → Tasks 6–7 ✓
- Auth: argon2id hashing, signed HTTP-only session cookie, login/logout, `/api/me` → Tasks 3, 4, 6 ✓
- Per-request role authorization; owner-only routes 403 for crew → Tasks 6 (`requireOwner`), 7 (costs), 9 (admin) ✓
- **Server-side monetary redaction** for non-owners (records + search), authoritative via `monetary.ts` → Task 5; **golden test** → Task 8 ✓
- Owner bootstrap on first run; "no owner" boots with a clear locked state, not a crash → Tasks 4 (`bootstrapOwner`), 6 (`/api/me` `ownerConfigured`), 10 (entry-point warning) ✓
- Admin user CRUD (list/add/set-role/reset-password/delete) + last-owner guard → Tasks 4, 9 ✓
- Self-service password change → Tasks 4, 6 ✓
- Light login rate-limiting, generic 401 (no user-enumeration) → Task 6 ✓
- Demo mode: no-auth read-only owner-equivalent view, flagged → Tasks 6, 10 ✓
- "Today = real current date" via injected clock at the route boundary → Tasks 6, 7 ✓
- Carry-forward #1 (serializer-authoritative redaction), #2 (search redacted), #3 (ISO-date hardening) → Tasks 5, 7–8, 1 ✓
- README + CLAUDE.md kept current → Task 10 ✓

**Deferred to later plans (out of scope for P1b, by design):** record writes (`POST`/`PUT`/`DELETE` of trips/maintenance/etc.) + the write queue, git `add`/`commit`/`pull`/`push`, the sync scheduler, photo upload/compression (`sharp`) — P1c/P2. The SPA — P1d. Docker/compose/Pangolin + secrets/volumes — P2.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the assertions and the run command with expected result.

**Type consistency:** `Config`/`loadConfig`, `Session`/`createToken`/`verifyToken`/`SESSION_COOKIE`, `UserRole`/`UsersStore`/`PublicUser`/`UserRecord`, `Role`/`redactDataset`, `attachRole`/`requireAuth`/`requireOwner`/`loginLimiter`, `AppContext`/`createApp`, `register{Auth,Data,Admin}Routes`, and `buildTestApp`/`DEMO`/`FIXED_NOW` are used consistently across tasks. `UserRole` is the stored two-value role (`owner|crew`); `Role` is the three-value viewer role (`owner|crew|guest`, guest = unauthenticated) — used deliberately and distinctly. Collection→dataset-key mapping (`DATASET_KEY`) covers all six record collections. The `now` injection seam is threaded `createApp → AppContext → data/derived routes`.
