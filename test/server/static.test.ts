import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { buildTestApp } from './helpers.js';

/** A known demo photo file that ships in demo/photos/. */
const DEMO_PHOTO = 'boat-hero.jpg';

async function agentFor(role: 'owner' | 'crew') {
  const { app } = await buildTestApp();
  const agent = request.agent(app);
  await agent.post('/api/login').send({
    username: role === 'owner' ? 'owner1' : 'crew1',
    password: role === 'owner' ? 'ownerpass123' : 'crewpass123',
  });
  return agent;
}

describe('photo route', () => {
  it('streams a known demo photo (open in demo mode, no auth)', async () => {
    const { app } = await buildTestApp({ demo: true });
    const res = await request(app).get(`/photos/${DEMO_PHOTO}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
  });

  it('requires auth for photos outside demo mode (guest 401)', async () => {
    const { app } = await buildTestApp();
    await request(app).get(`/photos/${DEMO_PHOTO}`).expect(401);
  });

  it('serves photos to an authenticated crew member', async () => {
    const agent = await agentFor('crew');
    const res = await agent.get(`/photos/${DEMO_PHOTO}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
  });

  it('404s an unknown photo', async () => {
    const { app } = await buildTestApp({ demo: true });
    await request(app).get('/photos/does-not-exist.jpg').expect(404);
  });

  it('rejects a path-traversal attempt (.. escaping the photos dir)', async () => {
    const { app } = await buildTestApp({ demo: true });
    // Encoded so the path segment survives to the handler instead of being
    // normalized away by the router.
    for (const attempt of [
      '/photos/..%2f..%2fboat.yaml',
      '/photos/%2e%2e%2f%2e%2e%2fboat.yaml',
      '/photos/..%5c..%5cboat.yaml',
    ]) {
      const res = await request(app).get(attempt);
      expect([400, 404]).toContain(res.status);
      expect(res.text).not.toContain('name:'); // never leak boat.yaml contents
    }
  });

  it('rejects a nested sub-path (photos are a flat dir)', async () => {
    const { app } = await buildTestApp({ demo: true });
    const res = await request(app).get('/photos/sub/dir/x.jpg');
    expect([400, 404]).toContain(res.status);
  });

  it('carries no monetary data (it is a binary image, not JSON)', async () => {
    const { app } = await buildTestApp({ demo: true });
    const res = await request(app).get(`/photos/${DEMO_PHOTO}`);
    expect(res.headers['content-type']).not.toMatch(/application\/json/);
    expect(res.text ?? '').not.toMatch(/costEst|amount/);
  });
});

describe('SPA static handler + history fallback', () => {
  let distUi: string;
  let cleanup: string;

  beforeAll(() => {
    // Build a throwaway dist/ui with a recognizable index.html + one asset.
    cleanup = mkdtempSync(join(tmpdir(), 'shiplog-distui-'));
    distUi = join(cleanup, 'ui');
    mkdirSync(join(distUi, 'assets'), { recursive: true });
    writeFileSync(join(distUi, 'index.html'), '<!doctype html><title>SPA</title><div id="root" data-marker="spa-index"></div>');
    writeFileSync(join(distUi, 'assets', 'app.js'), 'console.log("asset");');
  });
  afterAll(() => rmSync(cleanup, { recursive: true, force: true }));

  it('serves index.html at the SPA root', async () => {
    const { app } = await buildTestApp({ demo: true, clientDir: distUi });
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('spa-index');
  });

  it('history-fallback: a deep app route returns index.html', async () => {
    const { app } = await buildTestApp({ demo: true, clientDir: distUi });
    const res = await request(app).get('/maintenance');
    expect(res.status).toBe(200);
    expect(res.text).toContain('spa-index');
  });

  it('serves a built asset directly', async () => {
    const { app } = await buildTestApp({ demo: true, clientDir: distUi });
    const res = await request(app).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('console.log');
  });

  it('NEVER shadows /api: an unknown API route stays a JSON 404', async () => {
    const { app } = await buildTestApp({ demo: true, clientDir: distUi });
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: 'not found' });
    expect(res.text).not.toContain('spa-index');
  });

  it('does not let the SPA fallback hijack /photos', async () => {
    const { app } = await buildTestApp({ demo: true, clientDir: distUi });
    const res = await request(app).get('/photos/does-not-exist.jpg');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('spa-index');
  });

  it('falls back gracefully (404 JSON) when no client build is configured', async () => {
    const { app } = await buildTestApp({ demo: true }); // no clientDir
    const res = await request(app).get('/some/app/route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
