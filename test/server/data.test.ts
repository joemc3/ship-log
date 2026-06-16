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
    // FIXED_NOW = 2024-07-01: the enriched demo has 4 overdue/due maintenance
    // items and no inventory tasks within the 30-day window at that date.
    expect(res.body.attention).toBe(4);
    expect(res.body.inventoryTasks).toHaveLength(0);
  });
});
