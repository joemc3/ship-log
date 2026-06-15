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
    await crew.put('/api/users/owner1').send({ role: 'crew' }).expect(403);
    await crew.delete('/api/users/owner1').expect(403);
  });

  it('forbids admin endpoints to an unauthenticated guest', async () => {
    const { app } = await buildTestApp();
    await request(app).get('/api/users').expect(403);
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

  it('resets a user password via PUT (new password works, old one is rejected)', async () => {
    const { agent, app } = await ownerAgent();
    await agent.post('/api/users').send({ username: 'resetme', password: 'oldpass123', role: 'crew' }).expect(201);
    await agent.put('/api/users/resetme').send({ password: 'resetpass123' }).expect(204);

    const fresh = request.agent(app);
    await fresh.post('/api/login').send({ username: 'resetme', password: 'resetpass123' }).expect(200);
    await request(app).post('/api/login').send({ username: 'resetme', password: 'oldpass123' }).expect(401);
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
