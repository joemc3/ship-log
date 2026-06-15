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
    config.login.max = 3;
    let last = 0;
    for (let i = 0; i < 5; i++) {
      last = (await request(app).post('/api/login').send({ username: 'owner1', password: 'nope' })).status;
    }
    expect(last).toBe(429);
  });
});
