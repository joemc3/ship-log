# Optional AI Purser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, off-by-default in-app web chat that lets authenticated owners and crew talk to a self-hosted OpenAI-compatible agent (the "Purser"), proxied server-side over SSE, with the logged-in identity injected and per-person memory.

**Architecture:** The browser talks only to Ship's Log's own origin. A new Express route group (`/api/assistant/*`) reads the verified session, injects a generic speaker system message + per-user memory headers, forwards to the agent's `/v1/chat/completions` (stream), and pipes tokens back as SSE. A shared transcript is stored in the users volume (never the git data repo). The whole feature is a **no-op when unconfigured**.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Express 5, Node 20 `fetch`, Vitest (two projects: `server`=node, `ui`=jsdom + Testing Library), React 18, `multer` (Phase 2 photo), `sharp` (existing photo pipeline).

## Global Constraints

- **TDD always.** Write the failing test first, then the minimal implementation. (Project rule; [[no-mvp-poc-phrasing]] — production quality in every step, no shortcuts.)
- **ESM imports use the `.js` suffix** even for `.ts` files (e.g. `import { x } from './foo.js'`).
- **Generic by default — no boat/agent-specific strings in the repo.** No "Valkyrie", "Jericho", "J.J.", etc. The persona lives in the operator's agent. UI label default is exactly `Ask the Purser`, and is overridable via `ASSISTANT_LABEL`.
- **Off by default.** With `ASSISTANT_URL` unset (and always in demo mode), `registerAssistantRoutes` registers nothing and `/api/me.assistant.enabled` is `false`.
- **Identity is server-derived and unspoofable.** The system message, `X-Hermes-Session-Id`, and `X-Hermes-Session-Key` are built from `req.viewer` — never from client input.
- **Transcript lives in the users volume** (`dirname(USERS_PATH)`), never inside `DATA_DIR` / the git data repo.
- **Cost-redaction exception is intentional** (owner-authorized): the assistant is NOT routed through `redactDataset`; it streams agent text, not dataset JSON. Do not route dataset JSON through it. Document it; do not "fix" it.
- **Doc-upkeep rule:** `README.md` and `CLAUDE.md` must be updated in the same change (Tasks 8 and 11).
- **Test commands:** single server file `npx vitest run test/server/<file>.test.ts`; single UI file `npx vitest run src/ui/<path>.test.tsx`; everything `npm test`; types `npm run typecheck`.

## Shared interfaces (defined across tasks; repeated here for reference)

```ts
// src/server/assistant.ts
export interface AssistantTurn {
  role: 'user' | 'assistant';
  name?: string;          // present for user turns (the speaker's username)
  content: string;
  at: string;             // ISO timestamp
  image?: boolean;        // Phase 2: a photo was attached to this user turn
}
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[]; }
export interface ChatParams {
  system: string;         // layered speaker/identity message
  messages: ChatMessage[];
  sessionId: string;      // shared conversation id (X-Hermes-Session-Id)
  sessionKey: string;     // per-user memory scope (X-Hermes-Session-Key)
}
export interface AssistantClient { chatStream(params: ChatParams): AsyncIterable<string>; }
export interface AssistantSettings { url: string; apiKey?: string; model: string; label: string; sessionId: string; chatLogPath: string; }
export function createAssistantClient(s: AssistantSettings): AssistantClient;

// src/server/app.ts
export interface AssistantDeps { client: AssistantClient; log: ChatLog; sessionId: string; label: string; }
// AppContext gains:  assistant?: AssistantDeps;
```

---

## Phase 1 — Conversation

### Task 1: Config — `ASSISTANT_*` env, secret-file, enabled derivation

**Files:**
- Modify: `src/server/config.ts`
- Test: `test/server/config.test.ts`

**Interfaces:**
- Produces: `Config.assistant?: { url: string; apiKey?: string; model: string; label: string; sessionId: string; chatLogPath: string }`

- [ ] **Step 1: Write the failing tests.** Append to `test/server/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadConfig } from '../../src/server/config.js';

const DEMO = '/tmp/demo-placeholder';

describe('config — assistant', () => {
  const base = { DATA_DIR: '/srv/data', SESSION_SECRET: 's', USERS_PATH: '/srv/var/users.json' };

  it('is undefined when ASSISTANT_URL is unset', () => {
    expect(loadConfig({ ...base }, DEMO).assistant).toBeUndefined();
  });

  it('is populated with defaults when ASSISTANT_URL is set', () => {
    const c = loadConfig({ ...base, ASSISTANT_URL: 'http://host.docker.internal:8642' }, DEMO);
    expect(c.assistant).toEqual({
      url: 'http://host.docker.internal:8642',
      apiKey: undefined,
      model: 'default',
      label: 'Ask the Purser',
      sessionId: 'shiplog',
      chatLogPath: join(dirname('/srv/var/users.json'), 'assistant-chatlog.json'),
    });
  });

  it('honors overrides', () => {
    const c = loadConfig(
      { ...base, ASSISTANT_URL: 'http://a', ASSISTANT_MODEL: 'm', ASSISTANT_LABEL: 'First Mate', ASSISTANT_SESSION_ID: 'boat' },
      DEMO,
    );
    expect(c.assistant?.model).toBe('m');
    expect(c.assistant?.label).toBe('First Mate');
    expect(c.assistant?.sessionId).toBe('boat');
  });

  it('resolves ASSISTANT_API_KEY_FILE indirection', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'shiplog-secret-')), 'key');
    writeFileSync(f, 'sekret\n');
    const c = loadConfig({ ...base, ASSISTANT_URL: 'http://a', ASSISTANT_API_KEY_FILE: f }, DEMO);
    expect(c.assistant?.apiKey).toBe('sekret');
  });

  it('is disabled in demo even if ASSISTANT_URL is set', () => {
    const c = loadConfig({ ASSISTANT_URL: 'http://a' }, DEMO); // no DATA_DIR/REPO ⇒ demo
    expect(c.demo).toBe(true);
    expect(c.assistant).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npx vitest run test/server/config.test.ts`
Expected: FAIL (`assistant` is undefined / property not on type).

- [ ] **Step 3: Implement the config changes.** In `src/server/config.ts`:

Add `join` and `dirname` to the path import:
```ts
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
```
Add the `assistant` field to the `Config` interface (after `pullIntervalMs`):
```ts
  assistant?: {
    url: string;
    apiKey?: string;
    model: string;
    label: string;
    sessionId: string;
    chatLogPath: string;
  };
```
Add the env keys to `envSchema`:
```ts
  ASSISTANT_URL: z.string().optional(),
  ASSISTANT_API_KEY: z.string().optional(),
  ASSISTANT_MODEL: z.string().optional(),
  ASSISTANT_LABEL: z.string().optional(),
  ASSISTANT_SESSION_ID: z.string().optional(),
```
Add the secret-file var:
```ts
const SECRET_FILE_VARS = ['SESSION_SECRET', 'OWNER_PASSWORD', 'DATA_REPO_TOKEN', 'ASSISTANT_API_KEY'] as const;
```
In the returned config object (inside `loadConfig`, before `return {`), build the assistant block, then add it to the return:
```ts
  const assistant = !demo && e.ASSISTANT_URL
    ? {
        url: e.ASSISTANT_URL,
        apiKey: e.ASSISTANT_API_KEY,
        model: e.ASSISTANT_MODEL ?? 'default',
        label: e.ASSISTANT_LABEL ?? 'Ask the Purser',
        sessionId: e.ASSISTANT_SESSION_ID ?? 'shiplog',
        chatLogPath: join(dirname(usersPath), 'assistant-chatlog.json'),
      }
    : undefined;
```
Add `assistant,` to the returned object literal.

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run test/server/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/server/config.ts test/server/config.test.ts
git commit -m "feat(assistant): config — ASSISTANT_* env, secret-file, enabled derivation"
```

---

### Task 2: Assistant client (`assistant.ts`)

**Files:**
- Create: `src/server/assistant.ts`
- Test: `test/server/assistant-client.test.ts`

**Interfaces:**
- Produces: `AssistantTurn`, `ContentPart`, `ChatMessage`, `ChatParams`, `AssistantClient`, `AssistantSettings`, `createAssistantClient(s)` (see Shared interfaces).

- [ ] **Step 1: Write the failing test.** Create `test/server/assistant-client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAssistantClient, type AssistantSettings } from '../../src/server/assistant.js';

const SETTINGS: AssistantSettings = {
  url: 'http://agent:8642', apiKey: 'k', model: 'm', label: 'Ask the Purser',
  sessionId: 'shiplog', chatLogPath: '/tmp/x.json',
};

/** A web ReadableStream that emits the given string chunks (as the SSE body would). */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('createAssistantClient', () => {
  it('POSTs the right request and yields content deltas in order', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        streamOf([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createAssistantClient(SETTINGS);
    const out: string[] = [];
    for await (const d of client.chatStream({
      system: 'You are speaking with joe (owner) via the ship\'s web app.',
      messages: [{ role: 'user', content: 'hi' }],
      sessionId: 'shiplog', sessionKey: 'joe',
    })) out.push(d);

    expect(out.join('')).toBe('Hello');
    expect(calls[0].url).toBe('http://agent:8642/v1/chat/completions');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    expect(headers['X-Hermes-Session-Id']).toBe('shiplog');
    expect(headers['X-Hermes-Session-Key']).toBe('joe');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('m');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are speaking with joe (owner) via the ship\'s web app.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })));
    const client = createAssistantClient(SETTINGS);
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of client.chatStream({ system: 's', messages: [], sessionId: 'shiplog', sessionKey: 'joe' })) { /* drain */ }
    }).rejects.toThrow();
  });

  it('omits Authorization when no apiKey is set', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(streamOf(['data: [DONE]\n\n']), { status: 200 });
    }));
    const client = createAssistantClient({ ...SETTINGS, apiKey: undefined });
    for await (const _ of client.chatStream({ system: 's', messages: [], sessionId: 'shiplog', sessionKey: 'joe' })) { /* drain */ }
    expect((calls[0].headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run test/server/assistant-client.test.ts`
Expected: FAIL (`createAssistantClient` not found).

- [ ] **Step 3: Implement `src/server/assistant.ts`.**

```ts
/**
 * Client for a self-hosted OpenAI-compatible agent (the "Purser"). Streams chat
 * completions and yields text deltas. The X-Hermes-Session-* headers scope the
 * agent's per-user memory on Hermes agents; non-Hermes agents ignore them.
 *
 * No persona/boat strings live here — the operator's agent owns its identity. We
 * only layer a generic speaker system message (built by the route from the session).
 */

export interface AssistantTurn {
  role: 'user' | 'assistant';
  name?: string;
  content: string;
  at: string;
  image?: boolean;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatParams {
  system: string;
  messages: ChatMessage[];
  sessionId: string;
  sessionKey: string;
}

export interface AssistantClient {
  chatStream(params: ChatParams): AsyncIterable<string>;
}

export interface AssistantSettings {
  url: string;
  apiKey?: string;
  model: string;
  label: string;
  sessionId: string;
  chatLogPath: string;
}

/** Parse one accumulated SSE buffer into [completeEvents, remainder]. */
function splitEvents(buf: string): [string[], string] {
  const parts = buf.split('\n\n');
  const remainder = parts.pop() ?? '';
  return [parts, remainder];
}

/** Extract the OpenAI delta content from a single `data: {...}` line, or null. */
function deltaFromEvent(evt: string): string | null {
  const line = evt.split('\n').find((l) => l.startsWith('data:'));
  if (!line) return null;
  const data = line.slice(5).trim();
  if (data === '[DONE]' || !data) return null;
  try {
    const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
    return json.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

export function createAssistantClient(s: AssistantSettings): AssistantClient {
  return {
    async *chatStream(params: ChatParams): AsyncIterable<string> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Hermes-Session-Id': params.sessionId,
        'X-Hermes-Session-Key': params.sessionKey,
      };
      if (s.apiKey) headers.Authorization = `Bearer ${s.apiKey}`;

      const res = await fetch(`${s.url}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: s.model,
          stream: true,
          messages: [{ role: 'system', content: params.system }, ...params.messages],
        }),
      });
      if (!res.ok || !res.body) throw new Error(`assistant request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const [events, remainder] = splitEvents(buf);
        buf = remainder;
        for (const evt of events) {
          const delta = deltaFromEvent(evt);
          if (delta) yield delta;
        }
      }
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run test/server/assistant-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/server/assistant.ts test/server/assistant-client.test.ts
git commit -m "feat(assistant): OpenAI-compatible streaming client with session headers"
```

---

### Task 3: Shared transcript store (`chatlog.ts`)

**Files:**
- Create: `src/server/chatlog.ts`
- Test: `test/server/chatlog.test.ts`

**Interfaces:**
- Consumes: `AssistantTurn` from `./assistant.js`.
- Produces: `class ChatLog` with `static load(path, cap?)`, `list(): AssistantTurn[]`, `append(turn): Promise<void>`, `clear(): Promise<void>`.

- [ ] **Step 1: Write the failing test.** Create `test/server/chatlog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatLog } from '../../src/server/chatlog.js';
import type { AssistantTurn } from '../../src/server/assistant.js';

const turn = (content: string, role: AssistantTurn['role'] = 'user'): AssistantTurn =>
  ({ role, content, at: '2024-07-01T00:00:00.000Z' });

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'shiplog-chatlog-')), 'log.json');
}

describe('ChatLog', () => {
  it('starts empty when the file is missing', async () => {
    const log = await ChatLog.load(tmpPath());
    expect(log.list()).toEqual([]);
  });

  it('appends and survives a reload', async () => {
    const path = tmpPath();
    const a = await ChatLog.load(path);
    await a.append(turn('hello'));
    await a.append(turn('hi there', 'assistant'));
    const b = await ChatLog.load(path);
    expect(b.list().map((t) => t.content)).toEqual(['hello', 'hi there']);
  });

  it('caps the retained turns, dropping the oldest', async () => {
    const path = tmpPath();
    const log = await ChatLog.load(path, 3);
    for (const n of ['1', '2', '3', '4']) await log.append(turn(n));
    expect(log.list().map((t) => t.content)).toEqual(['2', '3', '4']);
  });

  it('clear() empties the log and persists', async () => {
    const path = tmpPath();
    const a = await ChatLog.load(path);
    await a.append(turn('x'));
    await a.clear();
    expect(a.list()).toEqual([]);
    expect((await ChatLog.load(path)).list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run test/server/chatlog.test.ts`
Expected: FAIL (`ChatLog` not found).

- [ ] **Step 3: Implement `src/server/chatlog.ts`.**

```ts
/**
 * The shared assistant transcript — the communal thread the SPA renders. Stored as
 * a capped JSON array in the users volume (dirname(USERS_PATH)), NEVER in the git
 * data repo. Writes are serialized through a promise chain so concurrent requests
 * can't corrupt the file. The agent keeps its own long-term memory; this is display.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AssistantTurn } from './assistant.js';

const DEFAULT_CAP = 200;

export class ChatLog {
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private turns: AssistantTurn[],
    private readonly cap: number,
  ) {}

  static async load(path: string, cap = DEFAULT_CAP): Promise<ChatLog> {
    let turns: AssistantTurn[] = [];
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
      if (Array.isArray(parsed)) turns = parsed as AssistantTurn[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return new ChatLog(path, turns, cap);
  }

  list(): AssistantTurn[] {
    return [...this.turns];
  }

  append(turn: AssistantTurn): Promise<void> {
    return this.enqueue(async () => {
      this.turns.push(turn);
      if (this.turns.length > this.cap) this.turns = this.turns.slice(-this.cap);
      await this.persist();
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      this.turns = [];
      await this.persist();
    });
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(fn, fn);
    return this.queue;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.turns, null, 2), 'utf8');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run test/server/chatlog.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/server/chatlog.ts test/server/chatlog.test.ts
git commit -m "feat(assistant): shared capped transcript store (users volume)"
```

---

### Task 4: App wiring, `/api/me` summary, and no-op-when-disabled route group

**Files:**
- Modify: `src/server/app.ts` (add `AssistantDeps`, `AppContext.assistant`, register the route group)
- Create: `src/server/routes/assistant.ts` (skeleton that no-ops when no `assistant` dep; full handlers land in Task 5)
- Modify: `src/server/routes/auth.ts` (add the `assistant` summary to `/api/me`)
- Modify: `src/server/index.ts` (construct `AssistantDeps` when configured)
- Test: `test/server/assistant.test.ts` (Part A — wiring + disabled)

**Interfaces:**
- Consumes: `AssistantClient` (Task 2), `ChatLog` (Task 3), `Config.assistant` (Task 1).
- Produces: `AssistantDeps` (in `app.ts`); `registerAssistantRoutes(app, ctx)`.

- [ ] **Step 1: Write the failing test.** Create `test/server/assistant.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from '../../src/server/config.js';
import { UsersStore } from '../../src/server/users.js';
import { createApp, type AssistantDeps } from '../../src/server/app.js';
import { ShipStore } from '../../src/server/store.js';
import { ChatLog } from '../../src/server/chatlog.js';
import type { AssistantClient, ChatParams } from '../../src/server/assistant.js';
import { DEMO, FIXED_NOW, makeDataRepo } from './helpers.js';

/** A fake agent client that records params and yields canned deltas. */
function fakeClient(deltas: string[], capture?: (p: ChatParams) => void): AssistantClient {
  return {
    async *chatStream(params: ChatParams) {
      capture?.(params);
      for (const d of deltas) yield d;
    },
  };
}

interface BuildOpts { withAssistant?: boolean; deltas?: string[]; capture?: (p: ChatParams) => void; }

async function buildApp(opts: BuildOpts = {}): Promise<{ app: Express; log: ChatLog }> {
  const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
  const dataDir = await makeDataRepo();
  const config = loadConfig(
    { DATA_DIR: dataDir, SESSION_SECRET: 'test-secret', COOKIE_SECURE: 'false', USERS_PATH: usersPath },
    DEMO,
  );
  const store = await ShipStore.open(dataDir, { now: FIXED_NOW, sync: false });
  const users = await UsersStore.load(usersPath);
  await users.add('owner1', 'ownerpass123', 'owner');
  await users.add('crew1', 'crewpass123', 'crew');
  const log = await ChatLog.load(join(mkdtempSync(join(tmpdir(), 'shiplog-cl-')), 'log.json'));
  const assistant: AssistantDeps | undefined = opts.withAssistant
    ? { client: fakeClient(opts.deltas ?? ['hi'], opts.capture), log, sessionId: 'shiplog', label: 'Ask the Purser' }
    : undefined;
  const app = createApp({ config, store, users, now: FIXED_NOW, assistant });
  return { app, log };
}

async function login(app: Express, u: string, p: string) {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username: u, password: p }).expect(200);
  return agent;
}

describe('assistant — wiring & disabled', () => {
  it('when unconfigured, the route group is absent (JSON 404) and /api/me reports disabled', async () => {
    const { app } = await buildApp({ withAssistant: false });
    const agent = await login(app, 'owner1', 'ownerpass123');
    const hist = await agent.get('/api/assistant/history');
    expect(hist.status).toBe(404);
    expect(hist.body.error).toBe('not found');
    const me = await agent.get('/api/me');
    expect(me.body.assistant).toEqual({ enabled: false, label: 'Ask the Purser' });
  });

  it('when configured, /api/me reports enabled + label (authed only)', async () => {
    const { app } = await buildApp({ withAssistant: true });
    const agent = await login(app, 'owner1', 'ownerpass123');
    const me = await agent.get('/api/me');
    expect(me.body.assistant).toEqual({ enabled: true, label: 'Ask the Purser' });
    // Guest gets no assistant summary (same posture as sync).
    const guest = await request(app).get('/api/me');
    expect(guest.body.assistant).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run test/server/assistant.test.ts`
Expected: FAIL (`AssistantDeps` not exported; `assistant` not on `/api/me`).

- [ ] **Step 3: Add `AssistantDeps` + `AppContext.assistant` + register, in `src/server/app.ts`.**

Add imports near the other route imports:
```ts
import type { AssistantClient } from './assistant.js';
import type { ChatLog } from './chatlog.js';
import { registerAssistantRoutes } from './routes/assistant.js';
```
Add the dep type and extend `AppContext` (place `AssistantDeps` above `AppContext`):
```ts
export interface AssistantDeps {
  client: AssistantClient;
  log: ChatLog;
  sessionId: string;
  label: string;
}
```
In `AppContext`, add:
```ts
  assistant?: AssistantDeps;
```
In `createApp`, register the route group with the other routes (BEFORE the `/api` 404 — anywhere among the `registerXRoutes` calls):
```ts
  registerAssistantRoutes(app, ctx);
```

- [ ] **Step 4: Create the no-op skeleton `src/server/routes/assistant.ts`.** (Task 5 fills in the handlers.)

```ts
/**
 * The assistant API (`/api/assistant/*`). A NO-OP when the feature is unconfigured:
 * with no `ctx.assistant`, nothing is registered, so the paths fall through to the
 * standard JSON 404. Handlers are added in the next task.
 */
import type { Express } from 'express';
import type { AppContext } from '../app.js';

export function registerAssistantRoutes(app: Express, ctx: AppContext): void {
  const { assistant } = ctx;
  if (!assistant) return; // feature OFF — register nothing
  void app; // handlers added in Task 5
}
```

- [ ] **Step 5: Add the `assistant` summary to `/api/me` in `src/server/routes/auth.ts`.**

Add `assistant` to the destructure:
```ts
  const { config, store, users, now, assistant } = ctx;
```
Add a summary helper next to `syncSummary`:
```ts
/** Client-safe assistant summary for `/api/me`: whether the feature is on + the
 *  UI label. No URL/secret ever crosses the wire. */
function assistantSummary(assistant: AppContext['assistant']): { enabled: boolean; label: string } {
  return { enabled: !!assistant, label: assistant?.label ?? 'Ask the Purser' };
}
```
Import the `AppContext` type for the helper signature (add to the existing type imports at the top of the file):
```ts
import type { AppContext } from '../app.js';
```
In the `/api/me` handler, add the assistant summary alongside the sync summary (gated the same way):
```ts
    res.json({
      role: req.viewer.role,
      username: req.viewer.username,
      demo: config.demo,
      ownerConfigured: !users.isEmpty(),
      ...(showSync ? { sync: syncSummary(store), assistant: assistantSummary(assistant) } : {}),
    });
```

- [ ] **Step 6: Wire `index.ts` to build `AssistantDeps` when configured.** In `src/server/index.ts`:

Add imports:
```ts
import { createAssistantClient } from './assistant.js';
import { ChatLog } from './chatlog.js';
```
After `users` is loaded and before `createApp(...)`, build the deps:
```ts
  const assistant = config.assistant
    ? {
        client: createAssistantClient(config.assistant),
        log: await ChatLog.load(config.assistant.chatLogPath),
        sessionId: config.assistant.sessionId,
        label: config.assistant.label,
      }
    : undefined;
  if (assistant) console.log(`Assistant ("${assistant.label}") enabled → ${config.assistant!.url}`);
```
Pass it into `createApp`:
```ts
  const server = createApp({ config, store, users, assistant }).listen(config.port, () => {
```

- [ ] **Step 7: Run the test to verify it passes.**

Run: `npx vitest run test/server/assistant.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Verify the existing suite + types still pass.**

Run: `npx vitest run test/server/sync-routes.test.ts && npm run typecheck`
Expected: PASS (the `/api/me` change didn't break sync; types clean).

- [ ] **Step 9: Commit.**

```bash
git add src/server/app.ts src/server/routes/assistant.ts src/server/routes/auth.ts src/server/index.ts test/server/assistant.test.ts
git commit -m "feat(assistant): wire optional deps, /api/me summary, no-op when disabled"
```

---

### Task 5: Chat (SSE) + history + reset handlers

**Files:**
- Modify: `src/server/routes/assistant.ts` (the handlers)
- Test: `test/server/assistant.test.ts` (Part B — append the `describe` block below)

**Interfaces:**
- Consumes: `AssistantDeps` (client + log + sessionId), `requireAuth`/`requireOwner`/`denyInDemo`, `req.viewer`, `ctx.now`.
- Produces routes: `GET /api/assistant/history` → `{ turns }`; `POST /api/assistant/chat` (SSE `event: delta|done|error`); `DELETE /api/assistant/history` (204, owner-only).

- [ ] **Step 1: Write the failing tests.** Append to `test/server/assistant.test.ts`:

```ts
describe('assistant — chat, history, reset', () => {
  it('rejects a guest with 401', async () => {
    const { app } = await buildApp({ withAssistant: true });
    const r = await request(app).post('/api/assistant/chat').send({ message: 'hi' });
    expect(r.status).toBe(401);
  });

  it('streams deltas as SSE, injects the speaker identity, and records the thread', async () => {
    let seen: ChatParams | undefined;
    const { app, log } = await buildApp({ withAssistant: true, deltas: ['Hel', 'lo Joe'], capture: (p) => { seen = p; } });
    const agent = await login(app, 'owner1', 'ownerpass123');

    const r = await agent.post('/api/assistant/chat').send({ message: 'are we good?' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/event-stream/);
    expect(r.text).toContain('event: delta');
    expect(r.text).toContain(JSON.stringify('Hel'));
    expect(r.text).toContain(JSON.stringify('lo Joe'));
    expect(r.text).toContain('event: done');

    // Identity is server-derived and unspoofable.
    expect(seen?.system).toContain('owner1');
    expect(seen?.system).toContain('(owner)');
    expect(seen?.sessionId).toBe('shiplog');
    expect(seen?.sessionKey).toBe('owner1');
    expect(seen?.messages).toEqual([{ role: 'user', content: 'are we good?' }]);

    // Transcript captured both turns.
    const turns = log.list();
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: 'user', name: 'owner1', content: 'are we good?' });
    expect(turns[1]).toMatchObject({ role: 'assistant', content: 'Hello Joe' });
  });

  it('GET /history returns the shared thread to any authed viewer', async () => {
    const { app } = await buildApp({ withAssistant: true, deltas: ['ok'] });
    const owner = await login(app, 'owner1', 'ownerpass123');
    await owner.post('/api/assistant/chat').send({ message: 'first' });
    const crew = await login(app, 'crew1', 'crewpass123');
    const hist = await crew.get('/api/assistant/history');
    expect(hist.status).toBe(200);
    expect(hist.body.turns.map((t: { content: string }) => t.content)).toEqual(['first', 'ok']);
  });

  it('rejects an empty message with 400', async () => {
    const { app } = await buildApp({ withAssistant: true });
    const agent = await login(app, 'owner1', 'ownerpass123');
    const r = await agent.post('/api/assistant/chat').send({ message: '   ' });
    expect(r.status).toBe(400);
  });

  it('DELETE /history is owner-only and clears the thread', async () => {
    const { app, log } = await buildApp({ withAssistant: true, deltas: ['ok'] });
    const owner = await login(app, 'owner1', 'ownerpass123');
    await owner.post('/api/assistant/chat').send({ message: 'first' });

    const crew = await login(app, 'crew1', 'crewpass123');
    expect((await crew.delete('/api/assistant/history')).status).toBe(403);

    expect((await owner.delete('/api/assistant/history')).status).toBe(204);
    expect(log.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npx vitest run test/server/assistant.test.ts`
Expected: FAIL (handlers not implemented; routes 404).

- [ ] **Step 3: Implement the handlers in `src/server/routes/assistant.ts`** (replace the file body):

```ts
/**
 * The assistant API (`/api/assistant/*`). A NO-OP when the feature is unconfigured:
 * with no `ctx.assistant`, nothing is registered, so the paths fall through to the
 * standard JSON 404.
 *
 * Identity is server-derived: the speaker system message + the per-user memory key
 * come from `req.viewer`, never the client. The transcript is the shared communal
 * thread (display); the agent keeps its own long-term memory.
 */
import type { Express, Request } from 'express';
import type { AppContext } from '../app.js';
import { requireAuth, requireOwner, denyInDemo } from '../middleware.js';

/** Generic, boat/agent-agnostic speaker tag. The agent supplies its own persona. */
function speakerSystem(req: Request): string {
  const name = req.viewer.username ?? 'a crew member';
  return `You're speaking with ${name} (${req.viewer.role}) via the ship's web app.`;
}

function sse(res: import('express').Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerAssistantRoutes(app: Express, ctx: AppContext): void {
  const { assistant, config } = ctx;
  if (!assistant) return; // feature OFF — register nothing

  app.get('/api/assistant/history', requireAuth, (_req, res) => {
    res.json({ turns: assistant.log.list() });
  });

  app.post('/api/assistant/chat', requireAuth, denyInDemo(config), async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) { res.status(400).json({ error: 'message required' }); return; }

    await assistant.log.append({
      role: 'user', name: req.viewer.username ?? undefined, content: message, at: ctx.now().toISOString(),
    });

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let full = '';
    try {
      const stream = assistant.client.chatStream({
        system: speakerSystem(req),
        messages: [{ role: 'user', content: message }],
        sessionId: assistant.sessionId,
        sessionKey: req.viewer.username ?? 'shared',
      });
      for await (const delta of stream) {
        full += delta;
        sse(res, 'delta', delta);
      }
      await assistant.log.append({ role: 'assistant', content: full, at: ctx.now().toISOString() });
      sse(res, 'done', { ok: true });
    } catch {
      // Generic, sanitized reason only (never the agent URL/secret).
      sse(res, 'error', { error: "couldn't reach the assistant" });
    } finally {
      res.end();
    }
  });

  app.delete('/api/assistant/history', requireAuth, requireOwner, denyInDemo(config), async (_req, res) => {
    await assistant.log.clear();
    res.status(204).end();
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run test/server/assistant.test.ts`
Expected: PASS (Part A + Part B, 7 tests).

- [ ] **Step 5: Typecheck.**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/server/routes/assistant.ts test/server/assistant.test.ts
git commit -m "feat(assistant): chat (SSE) + shared history + owner-only reset"
```

---

### Task 6: SPA — types, API client methods, session exposure

**Files:**
- Modify: `src/ui/lib/types.ts` (extend `Me`; add `AssistantTurn`)
- Modify: `src/ui/lib/api.ts` (`assistantHistory`, `assistantSend`, `assistantReset`)
- Modify: `src/ui/state/session.tsx` (expose `assistantEnabled`, `assistantLabel`)
- Test: `src/ui/lib/api.test.ts` (append) and `src/ui/state/session.test.tsx` (append)

**Interfaces:**
- Produces (types): `Me.assistant?: { enabled: boolean; label: string }`; `AssistantTurn { role:'user'|'assistant'; name?: string; content: string; at: string; image?: boolean }`.
- Produces (api): `assistantHistory(): Promise<{ turns: AssistantTurn[] }>`; `assistantReset(): Promise<void>`; `assistantSend(message: string, onDelta: (t: string) => void): Promise<void>`.
- Produces (session): `Session.assistantEnabled: boolean`, `Session.assistantLabel: string`.

- [ ] **Step 1: Write the failing API test.** Append to `src/ui/lib/api.test.ts`:

```ts
describe('api — assistant', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('assistantHistory GETs the thread', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ turns: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.assistantHistory()).resolves.toEqual({ turns: [] });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/assistant/history');
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
```

> Note: ensure `import { describe, it, expect, vi, afterEach } from 'vitest';` is present at the top of `api.test.ts` (add any missing names).

- [ ] **Step 2: Run the API test to verify it fails.**

Run: `npx vitest run src/ui/lib/api.test.ts`
Expected: FAIL (`assistantHistory`/`assistantSend` not defined).

- [ ] **Step 3: Implement the types.** In `src/ui/lib/types.ts`:

Extend `Me`:
```ts
export interface Me {
  role: Role;
  username: string | null;
  demo: boolean;
  ownerConfigured: boolean;
  assistant?: { enabled: boolean; label: string };
}
```
Add the turn type (after `Me`):
```ts
/** One turn in the shared assistant thread (GET /api/assistant/history). */
export interface AssistantTurn {
  role: 'user' | 'assistant';
  name?: string;
  content: string;
  at: string;
  image?: boolean;
}
```

- [ ] **Step 4: Implement the API methods.** In `src/ui/lib/api.ts`:

Add `AssistantTurn` to the type import block:
```ts
  AssignableRole,
  AssistantTurn,
} from './types.js';
```
Add inside the `api` object (e.g. after `uploadPhoto`):
```ts
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
```

- [ ] **Step 5: Run the API test to verify it passes.**

Run: `npx vitest run src/ui/lib/api.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing session test.** `session.test.tsx` reads the context via a `Probe` component (testid spans) and `renderSession()`. First add two spans to `Probe` (after the `username` span):

```tsx
      <span data-testid="assistantEnabled">{String(s.assistantEnabled)}</span>
      <span data-testid="assistantLabel">{s.assistantLabel}</span>
```
Then add these two tests inside `describe('SessionProvider', ...)`:

```ts
it('exposes assistantEnabled + assistantLabel from /api/me', async () => {
  mockedMe.mockResolvedValue({
    role: 'owner', username: 'cap', demo: false, ownerConfigured: true,
    assistant: { enabled: true, label: 'Ask the Purser' },
  });
  renderSession();
  await waitFor(() => expect(screen.getByTestId('assistantEnabled')).toHaveTextContent('true'));
  expect(screen.getByTestId('assistantLabel')).toHaveTextContent('Ask the Purser');
});

it('defaults assistant flags off when /api/me omits them', async () => {
  mockedMe.mockResolvedValue(GUEST);
  renderSession();
  await waitFor(() => expect(screen.getByTestId('assistantEnabled')).toHaveTextContent('false'));
  expect(screen.getByTestId('assistantLabel')).toHaveTextContent('Ask the Purser');
});
```

- [ ] **Step 7: Run the session test to verify it fails.**

Run: `npx vitest run src/ui/state/session.test.tsx`
Expected: FAIL (`assistantEnabled` undefined).

- [ ] **Step 8: Implement the session exposure.** In `src/ui/state/session.tsx`:

Add to the `Session` interface (OPTIONAL on the type — the provider always populates
them with the defaults below, but optional means existing `Session` literals in other
page tests need no change):
```ts
  /** The optional Purser chat. Always populated by the provider (defaults below). */
  assistantEnabled?: boolean;
  assistantLabel?: string;
```
In the `useMemo` value object, add:
```ts
      assistantEnabled: me.assistant?.enabled ?? false,
      assistantLabel: me.assistant?.label ?? 'Ask the Purser',
```

- [ ] **Step 9: Run both UI tests to verify they pass.**

Run: `npx vitest run src/ui/lib/api.test.ts src/ui/state/session.test.tsx`
Expected: PASS.

- [ ] **Step 10: Typecheck (UI).**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 11: Commit.**

```bash
git add src/ui/lib/types.ts src/ui/lib/api.ts src/ui/state/session.tsx src/ui/lib/api.test.ts src/ui/state/session.test.tsx
git commit -m "feat(assistant): SPA types, API client (history/send/reset), session flags"
```

---

### Task 7: SPA — AssistantPage, route, and nav item

**Files:**
- Create: `src/ui/pages/AssistantPage.tsx`
- Create: `src/ui/pages/AssistantPage.module.css`
- Modify: `src/ui/AppRouter.tsx` (add the gated `/assistant` route)
- Modify: `src/ui/components/Shell.tsx` (add the nav item, gated by `assistantEnabled`; dynamic label)
- Test: `src/ui/pages/AssistantPage.test.tsx`
- Test: `src/ui/components/Shell.test.tsx` (append one nav case)

**Interfaces:**
- Consumes: `useSession()` (`assistantEnabled`, `assistantLabel`, `isOwner`, `demo`), `api.assistantHistory/assistantSend/assistantReset`, `Markdown` (`src/ui/pages/Markdown.js`), `Icon`.

- [ ] **Step 1: Write the failing page test.** Create `src/ui/pages/AssistantPage.test.tsx`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AssistantPage from './AssistantPage.js';
import { useSession, type Session } from '../state/session.js';
import { api } from '../lib/api.js';

vi.mock('../state/session.js', async (orig) => {
  const actual = await orig<typeof import('../state/session.js')>();
  return { ...actual, useSession: vi.fn() };
});
vi.mock('../lib/api.js', () => ({
  api: { assistantHistory: vi.fn(), assistantSend: vi.fn(), assistantReset: vi.fn() },
  ApiError: class ApiError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s; } },
}));

const mockedUseSession = vi.mocked(useSession);

function session(partial: Partial<Session>): Session {
  return {
    loading: false, role: 'crew', username: 'mate', demo: false, ownerConfigured: true,
    isOwner: false, isCrew: true, isAuthed: true,
    assistantEnabled: true, assistantLabel: 'Ask the Purser',
    refresh: vi.fn(), login: vi.fn(), logout: vi.fn(),
    ...partial,
  };
}

function renderPage(): void {
  render(<MemoryRouter><AssistantPage /></MemoryRouter>);
}

beforeEach(() => {
  mockedUseSession.mockReset();
  vi.mocked(api.assistantHistory).mockReset();
  vi.mocked(api.assistantSend).mockReset();
  vi.mocked(api.assistantReset).mockReset();
  mockedUseSession.mockReturnValue(session({}));
  vi.mocked(api.assistantHistory).mockResolvedValue({ turns: [] });
});

describe('AssistantPage', () => {
  it('renders the existing shared thread', async () => {
    vi.mocked(api.assistantHistory).mockResolvedValue({
      turns: [
        { role: 'user', name: 'cap', content: 'morning', at: '2024-07-01T00:00:00Z' },
        { role: 'assistant', content: 'Morning, Cap.', at: '2024-07-01T00:00:01Z' },
      ],
    });
    renderPage();
    expect(await screen.findByText('morning')).toBeInTheDocument();
    expect(await screen.findByText('Morning, Cap.')).toBeInTheDocument();
  });

  it('sends a message and renders streamed deltas', async () => {
    const user = userEvent.setup();
    vi.mocked(api.assistantSend).mockImplementation(async (_msg, onDelta) => {
      onDelta('All '); onDelta('good.');
    });
    renderPage();
    await user.type(screen.getByPlaceholderText(/message|ask/i), 'are we good?');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(vi.mocked(api.assistantSend)).toHaveBeenCalledWith('are we good?', expect.any(Function)));
    expect(await screen.findByText('are we good?')).toBeInTheDocument();
    expect(await screen.findByText('All good.')).toBeInTheDocument();
  });

  it('shows the reset control to an owner and clears the thread', async () => {
    const user = userEvent.setup();
    mockedUseSession.mockReturnValue(session({ role: 'owner', isOwner: true, isCrew: false }));
    vi.mocked(api.assistantReset).mockResolvedValue(undefined);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /reset|clear/i }));
    await waitFor(() => expect(vi.mocked(api.assistantReset)).toHaveBeenCalled());
  });

  it('hides the reset control from crew', async () => {
    renderPage();
    await screen.findByPlaceholderText(/message|ask/i);
    expect(screen.queryByRole('button', { name: /reset|clear/i })).toBeNull();
  });

  it('shows an unavailable notice when the assistant is disabled', () => {
    mockedUseSession.mockReturnValue(session({ assistantEnabled: false }));
    renderPage();
    expect(screen.getByText(/not available|unavailable|disabled/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/message|ask/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the page test to verify it fails.**

Run: `npx vitest run src/ui/pages/AssistantPage.test.tsx`
Expected: FAIL (no `AssistantPage`).

- [ ] **Step 3: Create `src/ui/pages/AssistantPage.module.css`.**

```css
.wrap { display: flex; flex-direction: column; height: calc(100vh - 120px); max-width: 820px; margin: 0 auto; }
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.thread { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 4px; }
.turn { max-width: 80%; padding: 10px 14px; border-radius: var(--r-md); border: 1px solid var(--line); }
.user { align-self: flex-end; background: var(--paper-2); }
.assistant { align-self: flex-start; background: var(--paper); }
.who { font-size: 12px; color: var(--ink-500); margin-bottom: 4px; }
.composer { display: flex; gap: 8px; margin-top: 12px; }
.composer textarea { flex: 1; resize: none; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-md); font: inherit; }
.notice { padding: 24px; text-align: center; color: var(--ink-500); }
```

- [ ] **Step 4: Create `src/ui/pages/AssistantPage.tsx`.**

```tsx
/**
 * The Purser chat (route `/assistant`). Renders the shared communal thread, sends
 * a message and streams the reply via SSE, and (owner-only) resets the thread. The
 * feature is optional: when `assistantEnabled` is false (unconfigured, or demo),
 * it shows an unavailable notice instead of the composer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../state/session.js';
import { api } from '../lib/api.js';
import type { AssistantTurn } from '../lib/types.js';
import { Markdown } from './Markdown.js';
import { Icon } from '../components/Icon.js';
import styles from './AssistantPage.module.css';

export default function AssistantPage(): JSX.Element {
  const { assistantEnabled, assistantLabel, isOwner } = useSession();
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    api.assistantHistory().then((r) => setTurns(r.turns)).catch(() => setTurns([]));
  }, []);

  useEffect(() => { if (assistantEnabled) reload(); }, [assistantEnabled, reload]);
  useEffect(() => { threadRef.current?.scrollTo(0, threadRef.current.scrollHeight); }, [turns, streaming]);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setDraft('');
    setTurns((t) => [...t, { role: 'user', content: message, at: new Date().toISOString() }]);
    let acc = '';
    try {
      await api.assistantSend(message, (delta) => { acc += delta; setStreaming(acc); });
      setTurns((t) => [...t, { role: 'assistant', content: acc, at: new Date().toISOString() }]);
    } catch {
      setError("Couldn't reach the Purser. Try again in a moment.");
    } finally {
      setStreaming('');
      setBusy(false);
    }
  }, [draft, busy]);

  const reset = useCallback(async () => {
    await api.assistantReset();
    setTurns([]);
  }, []);

  if (!assistantEnabled) {
    return (
      <div className="page-wrap">
        <div className={styles.notice}>The Purser chat is not available in this deployment.</div>
      </div>
    );
  }

  return (
    <div className={`page-wrap ${styles.wrap}`}>
      <div className={styles.head}>
        <h2>{assistantLabel}</h2>
        {isOwner && (
          <button className="btn btn-ghost" onClick={() => void reset()}>
            <Icon name="info" s={15} /> Reset thread
          </button>
        )}
      </div>

      <div className={styles.thread} ref={threadRef}>
        {turns.map((t, i) => (
          <div key={i} className={`${styles.turn} ${t.role === 'user' ? styles.user : styles.assistant}`}>
            {t.role === 'user'
              ? <><div className={styles.who}>{t.name ?? 'You'}</div>{t.content}</>
              : <Markdown source={t.content} />}
          </div>
        ))}
        {streaming && (
          <div className={`${styles.turn} ${styles.assistant}`}><Markdown source={streaming} /></div>
        )}
      </div>

      {error && <div role="alert" className="muted" style={{ marginTop: 8 }}>{error}</div>}

      <div className={styles.composer}>
        <textarea
          rows={2}
          placeholder="Message the Purser…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        <button className="btn btn-brass" disabled={busy || !draft.trim()} onClick={() => void send()}>
          <Icon name="arrowRight" s={16} /> Send
        </button>
      </div>
    </div>
  );
}
```

> `Markdown` is a named export — `Markdown({ source, className })` — so `import { Markdown } from './Markdown.js'` and `<Markdown source={...} />` as used here (confirmed against `TripsPage.tsx`).

- [ ] **Step 5: Add the route in `src/ui/AppRouter.tsx`.**

Add the import:
```ts
import AssistantPage from './pages/AssistantPage.js';
```
Add the gated route alongside the other authenticated reads:
```tsx
        <Route path="/assistant" element={<RequireAuth><AssistantPage /></RequireAuth>} />
```

- [ ] **Step 6: Add the nav item in `src/ui/components/Shell.tsx`.**

Extend the `show` predicate's type to include `assistantEnabled` (update the `NavItem` interface):
```ts
  show?: (s: { isOwner: boolean; isAuthed: boolean; assistantEnabled: boolean }) => boolean;
```
Add the item to the `NAV` `Operations` group (after Inventory, before Costs):
```ts
      { to: '/assistant', label: 'Ask the Purser', icon: 'crew', show: (s) => s.isAuthed && s.assistantEnabled },
```
In the component, pull `assistantEnabled` + `assistantLabel` from the session and include them in the `flags` used to filter (coerce the optional `assistantEnabled` to a boolean for the `show` predicate's type):
```ts
  const { isOwner, isAuthed, demo, username, logout, assistantEnabled, assistantLabel } = session;
```
```ts
  const flags = { isOwner, isAuthed, assistantEnabled: assistantEnabled ?? false };
```
Update the `groups` `useMemo` dependency list to include `assistantEnabled`:
```ts
  }, [isOwner, isAuthed, assistantEnabled]);
```
Render the dynamic label for the assistant item (in the nav `Link` map, replace `{it.label}`):
```tsx
                  {it.to === '/assistant' ? (assistantLabel ?? 'Ask the Purser') : it.label}
```
Add a crumb for the topbar title (in the `CRUMBS` map):
```ts
  assistant: 'Purser',
```

- [ ] **Step 7: Write the failing Shell nav test.** `Shell.test.tsx` already has a `session(partial)` factory and a `renderShell(s)` helper (and stubs `api.derived`/`welcome` in `beforeEach`). The `session()` defaults omit the assistant fields — that's fine (they're optional and the partial supplies them). Append inside `describe('Shell', ...)`:

```ts
it('hides the Purser nav item when assistantEnabled is false', async () => {
  renderShell(session({ role: 'crew', isCrew: true, isAuthed: true, assistantEnabled: false }));
  await screen.findByTestId('page-content');
  expect(screen.queryByRole('link', { name: /purser/i })).toBeNull();
});

it('shows the Purser nav item with its label when enabled', async () => {
  renderShell(session({ role: 'crew', isCrew: true, isAuthed: true, assistantEnabled: true, assistantLabel: 'Ask the Purser' }));
  expect(await screen.findByRole('link', { name: /ask the purser/i })).toBeInTheDocument();
});
```

- [ ] **Step 8: Run the page + shell tests to verify they fail, then pass after implementation.**

Run: `npx vitest run src/ui/pages/AssistantPage.test.tsx src/ui/components/Shell.test.tsx`
Expected: PASS once Steps 3–7 are in place. (Run once to see failures before implementing, once after.)

- [ ] **Step 9: Typecheck + full UI suite.**

Run: `npm run typecheck && npx vitest run --project ui`
Expected: PASS (other pages unaffected; `Session` gained only optional-defaulted flags).

- [ ] **Step 10: Commit.**

```bash
git add src/ui/pages/AssistantPage.tsx src/ui/pages/AssistantPage.module.css src/ui/AppRouter.tsx src/ui/components/Shell.tsx src/ui/pages/AssistantPage.test.tsx src/ui/components/Shell.test.tsx
git commit -m "feat(assistant): AssistantPage, /assistant route, gated nav item"
```

---

### Task 8: Docs + compose (Phase 1)

**Files:**
- Modify: `README.md` (new section "Optional: connect an AI Purser")
- Modify: `CLAUDE.md` (new "Optional assistant (Purser) layer" section)
- Modify: `docker-compose.yml` (add `extra_hosts` + `ASSISTANT_*` env)
- Modify: `docker-compose.vps.yml` (add `ASSISTANT_API_KEY_FILE` secret wiring — optional)

No automated test; this is documentation + compose. Validate compose parses.

- [ ] **Step 1: Add the `extra_hosts` + env to `docker-compose.yml`.** Under `services.shiplog`, add a top-level `extra_hosts` key (sibling of `environment`):

```yaml
    # Reach a Hermes/OpenAI-compatible agent running on the HOST (not in a
    # container) for the optional Purser chat. host-gateway resolves to the host.
    extra_hosts:
      - "host.docker.internal:host-gateway"
```
Inside `environment:`, add (after the "Server knobs" block):
```yaml
      # --- Optional AI Purser (off unless ASSISTANT_URL is set) ----------------
      # An OpenAI-compatible agent endpoint. Host process example below; omit to
      # disable the feature entirely (no nav item, routes return 404).
      ASSISTANT_URL: ${ASSISTANT_URL:-}
      # Optional bearer token for the agent endpoint (or ASSISTANT_API_KEY_FILE).
      ASSISTANT_API_KEY: ${ASSISTANT_API_KEY:-}
      # The model string sent in the request (agent may treat it as a passthrough).
      ASSISTANT_MODEL: ${ASSISTANT_MODEL:-}
      # UI label for the nav item + page (default "Ask the Purser").
      ASSISTANT_LABEL: ${ASSISTANT_LABEL:-}
      # Shared conversation id for the communal thread (default "shiplog").
      ASSISTANT_SESSION_ID: ${ASSISTANT_SESSION_ID:-}
```

- [ ] **Step 2: (Optional) wire the secret-file form in `docker-compose.vps.yml`.** If the operator uses a Docker secret for the agent key, add under `services.shiplog.environment`:

```yaml
      # Optional: agent API key as a Docker secret (resolved by config.ts).
      ASSISTANT_API_KEY_FILE: /run/secrets/assistant_api_key
```
…and a matching `secrets:` entry list item `- assistant_api_key` on the service plus a top-level `secrets.assistant_api_key.file: ./secrets/assistant_api_key`. (Mirror the existing `session_secret` wiring exactly.)

- [ ] **Step 3: Validate both compose files parse.**

Run: `docker compose -f docker-compose.yml config >/dev/null && docker compose -f docker-compose.yml -f docker-compose.vps.yml config >/dev/null && echo OK`
Expected: `OK` (no schema errors). If `docker` is unavailable in the dev env, skip with a note.

- [ ] **Step 4: Add the README section.** Insert a new `## Optional: connect an AI Purser` section (after `## Self-hosting`), covering, in prose:
  - **What it is** — an optional in-app chat to a self-hosted OpenAI-compatible agent (e.g. a Nous Research Hermes agent) that acts as the boat's "Purser." Owners + crew only; guests never see it.
  - **It is off by default** — with `ASSISTANT_URL` unset, the feature is entirely absent (no nav item, routes 404, `/api/me.assistant.enabled=false`). The app is fully functional without it. To run with no Purser, simply leave `ASSISTANT_URL` unset.
  - **Prerequisites** — a self-hosted agent exposing an OpenAI-compatible HTTP endpoint (for Hermes: enable its API server). It can run on the host or another container.
  - **Configuration** — the `ASSISTANT_*` env table (URL, API key / `_FILE`, model, label, session id).
  - **Container→host networking** — the agent often runs on the host; the compose adds `host.docker.internal:host-gateway`, so set `ASSISTANT_URL=http://host.docker.internal:<port>`.
  - **Security** — keep the agent port reachable by the container but NOT public (host firewall); the tunnel only fronts Ship's Log. Set `ASSISTANT_API_KEY` if the agent supports it. Identity is server-derived (a crew member can't impersonate the owner).
  - **Per-crew memory (Hermes)** — the app sends `X-Hermes-Session-Key=<username>` so a Hermes agent keeps a separate long-term model per person; non-Hermes agents ignore it and the chat still works.
  - **Cost note** — the assistant is intentionally not cost-redacted; if crew ask it a cost question it may answer. The normal app pages stay redacted.

- [ ] **Step 5: Add the CLAUDE.md section.** Insert a new `## Optional assistant (Purser) layer` section documenting:
  - The three units: `src/server/assistant.ts` (OpenAI-compatible streaming client + session headers), `src/server/chatlog.ts` (shared capped transcript in the users volume — NEVER the data repo), `src/server/routes/assistant.ts` (`GET/POST/DELETE /api/assistant/*`).
  - **Optionality:** `registerAssistantRoutes` is a no-op when `ctx.assistant` is absent; `index.ts` only builds `AssistantDeps` when `config.assistant` is set (non-demo + `ASSISTANT_URL`). `/api/me` carries `assistant:{enabled,label}` (authed/demo only, like `sync`).
  - **Identity injection:** the speaker system message + `X-Hermes-Session-Id` (shared) + `X-Hermes-Session-Key` (`username`) are server-derived from `req.viewer`, never the client.
  - **Generic-naming rule:** no boat/agent strings in the repo; label via `ASSISTANT_LABEL` (default "Ask the Purser").
  - **Cost-redaction exception:** intentional, owner-authorized. The assistant streams agent text (not dataset JSON), so `redaction-golden` is unaffected; never route dataset JSON through it. Do not "fix" crew access as a bug.
  - **Same-change rule:** when you add an `ASSISTANT_*` config var, update `config.ts` (`SECRET_FILE_VARS` if secret-bearing), `README.md`, and this section together.

- [ ] **Step 6: Commit.**

```bash
git add README.md CLAUDE.md docker-compose.yml docker-compose.vps.yml
git commit -m "docs(assistant): Phase 1 — README + CLAUDE.md + compose wiring"
```

---

## Phase 2 — Photos & files to the agent

### Task 9: Server — accept an attached photo and forward it as vision input

**Files:**
- Modify: `src/server/routes/assistant.ts` (multipart on the chat route; compress + forward as `image_url`)
- Test: `test/server/assistant.test.ts` (append a Phase-2 `describe` block)

**Interfaces:**
- Consumes: `compressPhoto`, `photoName`(unused here), `PhotoError` from `../photos.js`; `multer`; `ContentPart` from `../assistant.js`.
- Behavior: `POST /api/assistant/chat` additionally accepts `multipart/form-data` with field `message` (text) + optional `photo` (file). When a photo is present, the message sent to the agent is `[{type:'text',text}, {type:'image_url',image_url:{url:'data:image/jpeg;base64,...'}}]`, and the stored user turn sets `image: true`. Bad type → 415; too large → 413.

- [ ] **Step 1: Write the failing tests.** Append to `test/server/assistant.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

async function tinyJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
}

describe('assistant — photo input (Phase 2)', () => {
  it('forwards an attached photo as an image_url content part', async () => {
    let seen: ChatParams | undefined;
    const { app } = await buildApp({ withAssistant: true, deltas: ['looks frayed'], capture: (p) => { seen = p; } });
    const agent = await login(app, 'owner1', 'ownerpass123');
    const jpeg = await tinyJpeg();

    const r = await agent
      .post('/api/assistant/chat')
      .field('message', 'is this line ok?')
      .attach('photo', jpeg, 'line.jpg');

    expect(r.status).toBe(200);
    const parts = seen?.messages[0].content;
    expect(Array.isArray(parts)).toBe(true);
    const arr = parts as { type: string; image_url?: { url: string } }[];
    expect(arr[0]).toEqual({ type: 'text', text: 'is this line ok?' });
    expect(arr[1].type).toBe('image_url');
    expect(arr[1].image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('rejects a non-image attachment with 415', async () => {
    const { app } = await buildApp({ withAssistant: true });
    const agent = await login(app, 'owner1', 'ownerpass123');
    const r = await agent
      .post('/api/assistant/chat')
      .field('message', 'see this')
      .attach('photo', Buffer.from('not an image'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(r.status).toBe(415);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npx vitest run test/server/assistant.test.ts`
Expected: FAIL (multipart not handled; no image part).

- [ ] **Step 3: Implement multipart + image forwarding in `src/server/routes/assistant.ts`.**

Add imports:
```ts
import multer from 'multer';
import { compressPhoto, PhotoError } from '../photos.js';
import type { ContentPart } from '../assistant.js';
```
Create an in-memory multer instance (top of `registerAssistantRoutes`, after the `if (!assistant) return;`):
```ts
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } });
```
Change the chat route to run `upload.single('photo')` (multer no-ops on non-multipart requests, so the JSON path is unchanged), and build the content from the optional file:
```ts
  app.post('/api/assistant/chat', requireAuth, denyInDemo(config), upload.single('photo'), async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message && !req.file) { res.status(400).json({ error: 'message required' }); return; }

    let content: string | ContentPart[] = message;
    let hasImage = false;
    if (req.file) {
      try {
        const { bytes } = await compressPhoto(req.file.buffer, req.file.mimetype);
        const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
        content = [
          { type: 'text', text: message || 'Please look at this photo.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ];
        hasImage = true;
      } catch (err) {
        if (err instanceof PhotoError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    }

    await assistant.log.append({
      role: 'user', name: req.viewer.username ?? undefined,
      content: message || '(photo)', at: ctx.now().toISOString(), image: hasImage || undefined,
    });

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let full = '';
    try {
      const stream = assistant.client.chatStream({
        system: speakerSystem(req),
        messages: [{ role: 'user', content }],
        sessionId: assistant.sessionId,
        sessionKey: req.viewer.username ?? 'shared',
      });
      for await (const delta of stream) { full += delta; sse(res, 'delta', delta); }
      await assistant.log.append({ role: 'assistant', content: full, at: ctx.now().toISOString() });
      sse(res, 'done', { ok: true });
    } catch {
      sse(res, 'error', { error: "couldn't reach the assistant" });
    } finally {
      res.end();
    }
  });
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run test/server/assistant.test.ts`
Expected: PASS (all Phase 1 + Phase 2 server tests).

- [ ] **Step 5: Typecheck.**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/server/routes/assistant.ts test/server/assistant.test.ts
git commit -m "feat(assistant): Phase 2 — accept a photo and forward it as vision input"
```

---

### Task 10: SPA — attach a photo in the composer

**Files:**
- Modify: `src/ui/lib/api.ts` (`assistantSend` gains an optional `file`)
- Modify: `src/ui/pages/AssistantPage.tsx` (attach control + thumbnail preview + error copy)
- Test: `src/ui/pages/AssistantPage.test.tsx` (append cases)

**Interfaces:**
- Produces (api): `assistantSend(message: string, onDelta: (t: string) => void, file?: File): Promise<void>` — sends `FormData` (field `message` + `photo`) when `file` is set, JSON otherwise.

- [ ] **Step 1: Write the failing test.** Append to `src/ui/pages/AssistantPage.test.tsx`:

```ts
it('attaches a photo and sends it with the message', async () => {
  const user = userEvent.setup();
  vi.mocked(api.assistantSend).mockImplementation(async (_m, onDelta) => { onDelta('I see it.'); });
  renderPage();
  const file = new File([new Uint8Array([1, 2, 3])], 'line.jpg', { type: 'image/jpeg' });
  await user.upload(screen.getByLabelText(/attach|photo/i), file);
  await user.type(screen.getByPlaceholderText(/message|ask/i), 'is this ok?');
  await user.click(screen.getByRole('button', { name: /send/i }));
  await waitFor(() =>
    expect(vi.mocked(api.assistantSend)).toHaveBeenCalledWith('is this ok?', expect.any(Function), file),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run src/ui/pages/AssistantPage.test.tsx`
Expected: FAIL (no attach control; `assistantSend` arity).

- [ ] **Step 3: Extend `assistantSend` in `src/ui/lib/api.ts`** to accept an optional file:

```ts
  assistantSend: async (message: string, onDelta: (text: string) => void, file?: File): Promise<void> => {
    const init: RequestInit = { method: 'POST', credentials: 'include' };
    if (file) {
      const form = new FormData();
      form.append('message', message);
      form.append('photo', file);
      init.body = form; // browser sets the multipart boundary; do NOT set Content-Type
      init.headers = { Accept: 'text/event-stream' };
    } else {
      init.headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
      init.body = JSON.stringify({ message });
    }
    const res = await fetch('/api/assistant/chat', init);
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
```

- [ ] **Step 4: Add the attach control + preview to `src/ui/pages/AssistantPage.tsx`.**

Add file state:
```tsx
  const [photo, setPhoto] = useState<File | null>(null);
```
Pass it through `send` (and clear after) — update the `assistantSend` call and the optimistic turn:
```tsx
    setTurns((t) => [...t, { role: 'user', content: message, at: new Date().toISOString(), image: !!photo }]);
    let acc = '';
    try {
      await api.assistantSend(message, (delta) => { acc += delta; setStreaming(acc); }, photo ?? undefined);
      setTurns((t) => [...t, { role: 'assistant', content: acc, at: new Date().toISOString() }]);
      setPhoto(null);
    } catch (e) {
      const msg = e instanceof Error && /unsupported|limit|413|415/i.test(e.message)
        ? 'That photo could not be sent (unsupported type or too large).'
        : "Couldn't reach the Purser. Try again in a moment.";
      setError(msg);
    } finally {
```
Allow sending when a photo is attached even with an empty message — update the guard and the Send button:
```tsx
    if ((!message && !photo) || busy) return;
```
```tsx
        <button className="btn btn-brass" disabled={busy || (!draft.trim() && !photo)} onClick={() => void send()}>
```
Add the attach input + preview to the composer (before the textarea):
```tsx
        <label className="btn btn-ghost" title="Attach a photo">
          <Icon name="box" s={16} /> Attach
          <input
            type="file"
            accept="image/*"
            aria-label="Attach photo"
            style={{ display: 'none' }}
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </label>
        {photo && <span className="muted tiny">{photo.name}</span>}
```

- [ ] **Step 5: Run the page test to verify it passes.**

Run: `npx vitest run src/ui/pages/AssistantPage.test.tsx`
Expected: PASS (all page tests).

- [ ] **Step 6: Typecheck + full UI suite.**

Run: `npm run typecheck && npx vitest run --project ui`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/ui/lib/api.ts src/ui/pages/AssistantPage.tsx src/ui/pages/AssistantPage.test.tsx
git commit -m "feat(assistant): Phase 2 — photo attach in the composer"
```

---

### Task 11: Docs (Phase 2)

**Files:**
- Modify: `README.md` (extend the Purser section with the photo workflow)
- Modify: `CLAUDE.md` (note image forwarding + the vision-model dependency)

- [ ] **Step 1: Extend the README Purser section.** Add a short subsection covering the visual-inspection workflow: attach a photo in the composer (e.g. a possibly-frayed line), the server compresses it (reusing the photo pipeline) and forwards it to the agent as image content so it can *see* it; the agent can then act through its data-repo tools as usual. Note the dependency: **the configured agent's model must support image input (vision)** — a text-only model will ignore the image.

- [ ] **Step 2: Extend the CLAUDE.md assistant section.** Note that `POST /api/assistant/chat` also accepts `multipart/form-data` (`message` + optional `photo`), compresses via `compressPhoto`, and forwards a `data:` `image_url` content part; bad type/size map to 415/413. Chat photos are sent as vision input and noted in the transcript (`image:true`) but NOT persisted as files by the app (the agent persists to the data repo if it logs maintenance) — call out re-displaying chat photos as a possible later addition. Reiterate: vision requires a vision-capable agent model.

- [ ] **Step 3: Commit.**

```bash
git add README.md CLAUDE.md
git commit -m "docs(assistant): Phase 2 — photo workflow + vision dependency"
```

---

## Final verification (after all tasks)

- [ ] **Full suite:** `npm test` → all green (server + ui projects).
- [ ] **Types:** `npm run typecheck` → clean (server `tsconfig.json` + `tsconfig.ui.json`).
- [ ] **Optionality smoke:** with `ASSISTANT_URL` unset, `npm start` boots, `/api/assistant/history` is a JSON 404, and the SPA shows no Purser nav item.
- [ ] **Redaction golden still green:** `npx vitest run test/server/redaction-golden.test.ts` (the assistant must not have leaked dataset JSON into a redacted surface).

## Notes for the implementer (verify-during-build, from the spec)

- Confirm the agent tolerates a **constant `X-Hermes-Session-Id` with a varying `X-Hermes-Session-Key`** (per the agent's documented contract).
- Confirm the agent's **streaming framing** matches the `data: {choices:[{delta:{content}}]}` shape `assistant.ts` parses; adjust `deltaFromEvent` if the agent differs.
- (Phase 2) Confirm the agent's **model supports image input** and accepts a base64 `data:` URI in an `image_url` part (vs. a hosted URL).
- Decide the transcript **cap** (`ChatLog.load` default is 200) if a different retention is wanted.
