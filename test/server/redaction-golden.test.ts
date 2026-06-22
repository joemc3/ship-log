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
    const byAmount = await agent.get('/api/search?q=92.5');
    expect(byAmount.body.some((h: { collection: string }) => h.collection === 'cost')).toBe(false);
    const byWord = await agent.get('/api/search?q=halyard');
    expect(byWord.body.some((h: { collection: string }) => h.collection === 'cost')).toBe(false);
    // Assert search isn't vacuously empty — crew must still find non-cost matches
    expect(byWord.body.length).toBeGreaterThan(0);
    expect(byWord.body.some((h: { collection: string; id: string }) => h.collection === 'maintenance' && h.id === 'm-jib-halyard')).toBe(true);
  });

  it('a guest gets no collection data at all (only welcome + me)', async () => {
    const { app } = await buildTestApp();
    for (const ep of CREW_ENDPOINTS) {
      await request(app).get(ep).expect(401);
    }
    await request(app).get('/api/costs').expect(403);
    await request(app).get('/api/costs/c-jib-halyard').expect(403);
    await request(app).get('/api/welcome').expect(200);
  });

  it('no monetary key appears in any crew WRITE response', async () => {
    const { app } = await buildTestApp();
    const agent = request.agent(app);
    await agent.post('/api/login').send({ username: 'crew1', password: 'crewpass123' });

    const trip = await agent.post('/api/trips').send({ date: '2024-08-20', title: 'Eve sail', body: 'Calm.' });
    expect(trip.status).toBe(201);
    assertNoMonetaryKey(trip.body, 'POST /api/trips');

    // Completing a maintenance item that carries a costEst must not echo it back.
    const done = await agent.post('/api/maintenance/m-jib-halyard/complete').send({ completed: '2024-07-09' });
    expect(done.status).toBe(200);
    assertNoMonetaryKey(done.body, 'POST /api/maintenance/:id/complete');
    expect('costEst' in done.body).toBe(false);
  });

  it('conditions is public and carries no monetary key (crew + guest)', async () => {
    const { app } = await buildTestApp();
    // Guest (no login) can read it — it is all-access like welcome.
    const guest = await request(app).get('/api/conditions');
    expect(guest.status).toBe(200);
    assertNoMonetaryKey(guest.body, '/api/conditions (guest)');

    // Crew sees the same money-free surface.
    const agent = request.agent(app);
    await agent.post('/api/login').send({ username: 'crew1', password: 'crewpass123' });
    const crew = await agent.get('/api/conditions');
    expect(crew.status).toBe(200);
    assertNoMonetaryKey(crew.body, '/api/conditions (crew)');
  });
});
