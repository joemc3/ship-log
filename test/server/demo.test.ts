import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers.js';

describe('demo mode', () => {
  it('serves everything as owner with no auth, and flags demo', async () => {
    const { app } = await buildTestApp({ demo: true });
    const me = await request(app).get('/api/me');
    expect(me.body).toMatchObject({ role: 'owner', demo: true });

    const costs = await request(app).get('/api/costs');
    expect(costs.status).toBe(200);
    expect(costs.body.map((c: { id: string }) => c.id)).toContain('c-jib-halyard');

    const maint = (await request(app).get('/api/maintenance')).body.find((m: { id: string }) => m.id === 'm-jib-halyard');
    expect(maint.costEst).toBe(95);
  });

  it('disables login in demo mode', async () => {
    const { app } = await buildTestApp({ demo: true });
    const res = await request(app).post('/api/login').send({ username: 'x', password: 'y' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/demo/i);
  });

  it('disables admin writes in demo mode', async () => {
    const { app } = await buildTestApp({ demo: true });
    await request(app)
      .post('/api/users')
      .send({ username: 'x', password: 'y'.repeat(8), role: 'crew' })
      .expect(403);
  });

  it('returns JSON, not HTML, on a malformed request body', async () => {
    const { app } = await buildTestApp();
    const res = await request(app)
      .post('/api/login')
      .set('Content-Type', 'application/json')
      .send('{ not valid json');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error).toBeTruthy();
  });

  it('returns a JSON 404 on an unmatched route', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error).toBeTruthy();
  });
});
