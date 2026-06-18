import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import sharp from 'sharp';
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

/** A fake agent client whose chatStream always throws. */
function throwingClient(): AssistantClient {
  return {
    // eslint-disable-next-line require-yield
    async *chatStream(_params: ChatParams) {
      throw new Error('simulated stream failure');
    },
  };
}

interface BuildOpts { withAssistant?: boolean; deltas?: string[]; capture?: (p: ChatParams) => void; throws?: boolean; }

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
  const client = opts.throws ? throwingClient() : fakeClient(opts.deltas ?? ['hi'], opts.capture);
  const assistant: AssistantDeps | undefined = opts.withAssistant
    ? { client, log, sessionId: 'shiplog', label: 'Ask the Purser' }
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

  it('emits event: error with generic message when chatStream throws, and records only the user turn', async () => {
    const { app, log } = await buildApp({ withAssistant: true, throws: true });
    const agent = await login(app, 'owner1', 'ownerpass123');

    const r = await agent.post('/api/assistant/chat').send({ message: 'will this fail?' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/event-stream/);
    expect(r.text).toContain('event: error');
    expect(r.text).toContain(JSON.stringify({ error: "couldn't reach the assistant" }));
    expect(r.text).not.toContain('event: done');

    // User turn was recorded; assistant turn was NOT (stream never completed).
    const turns = log.list();
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ role: 'user', content: 'will this fail?' });
  });
});

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
    expect(seen).toBeDefined();
    const parts = seen!.messages[0]!.content;
    expect(Array.isArray(parts)).toBe(true);
    const arr = parts as { type: string; image_url?: { url: string } }[];
    expect(arr[0]!).toEqual({ type: 'text', text: 'is this line ok?' });
    expect(arr[1]!.type).toBe('image_url');
    expect(arr[1]!.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
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

  it('returns 413 (not 500) when the attached photo exceeds the multer size limit', async () => {
    const { app } = await buildApp({ withAssistant: true });
    const agent = await login(app, 'owner1', 'ownerpass123');
    // Allocate a buffer just over 30 MB to trigger multer's LIMIT_FILE_SIZE error.
    const oversized = Buffer.alloc(31 * 1024 * 1024);
    const r = await agent
      .post('/api/assistant/chat')
      .field('message', 'big photo')
      .attach('photo', oversized, { filename: 'huge.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(413);
  });
});
