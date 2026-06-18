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
