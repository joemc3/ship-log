import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers.js';

/** A known demo manual PDF that ships in demo/manuals/. */
const DEMO_PDF = 'universal-m25.pdf';

async function agentFor(role: 'owner' | 'crew') {
  const { app } = await buildTestApp();
  const agent = request.agent(app);
  await agent.post('/api/login').send({
    username: role === 'owner' ? 'owner1' : 'crew1',
    password: role === 'owner' ? 'ownerpass123' : 'crewpass123',
  });
  return agent;
}

describe('manual-file route GET /files/manuals/:name', () => {
  it('streams a known demo manual PDF (open in demo mode, no auth)', async () => {
    const { app } = await buildTestApp({ demo: true });
    const res = await request(app).get(`/files/manuals/${DEMO_PDF}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
    // PDF magic bytes survive the stream (it's a real binary, not JSON).
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('serves a manual to an authenticated crew member (reads posture)', async () => {
    const agent = await agentFor('crew');
    const res = await agent.get(`/files/manuals/${DEMO_PDF}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('requires auth outside demo mode (guest 401)', async () => {
    const { app } = await buildTestApp();
    await request(app).get(`/files/manuals/${DEMO_PDF}`).expect(401);
  });

  it('404s an unknown manual', async () => {
    const { app } = await buildTestApp({ demo: true });
    await request(app).get('/files/manuals/does-not-exist.pdf').expect(404);
  });

  it('rejects a path-traversal attempt (.. escaping the manuals dir)', async () => {
    const { app } = await buildTestApp({ demo: true });
    for (const attempt of [
      '/files/manuals/..%2f..%2fboat.yaml',
      '/files/manuals/%2e%2e%2f%2e%2e%2fboat.yaml',
      '/files/manuals/..%5c..%5cboat.yaml',
      '/files/manuals/..%2f..%2fcosts%2fc-2026-05-12-fuel.md',
    ]) {
      const res = await request(app).get(attempt);
      expect([400, 404]).toContain(res.status);
      expect(res.text ?? '').not.toContain('name:'); // never leak boat.yaml
      expect(res.text ?? '').not.toMatch(/amount|costEst/); // never leak a cost record
    }
  });

  it('rejects a nested sub-path (manuals are a flat dir, scoped to manuals/ only)', async () => {
    const { app } = await buildTestApp({ demo: true });
    const res = await request(app).get('/files/manuals/sub/dir/x.pdf');
    expect([400, 404]).toContain(res.status);
  });

  it('is scoped to manuals/ only — cannot reach costs/ via /files', async () => {
    const { app } = await buildTestApp({ demo: true });
    // There is no generic /files/<collection> server; only /files/manuals/* exists.
    const res = await request(app).get('/files/costs/c-2026-05-12-fuel.md');
    expect(res.status).toBe(404);
    expect(res.text ?? '').not.toMatch(/amount|costEst/);
  });

  it('serves the markdown-companion manual files too (correct content-type)', async () => {
    const { app } = await buildTestApp({ demo: true });
    const res = await request(app).get('/files/manuals/man-engine.md');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown|text\/plain/);
  });

  it('does not let the SPA fallback hijack /files', async () => {
    // Build a throwaway dist/ui so the SPA static handler is active; an unknown
    // /files path must stay a JSON 404, never index.html.
    const { app } = await buildTestApp({ demo: true });
    const res = await request(app).get('/files/manuals/nope.pdf');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.text).not.toContain('<html');
  });
});
