import { describe, it, expect } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { buildTestApp } from './helpers.js';

async function loginAs(role: 'owner' | 'crew') {
  const { app } = await buildTestApp();
  const agent = request.agent(app);
  await agent.post('/api/login').send({
    username: role === 'owner' ? 'owner1' : 'crew1',
    password: role === 'owner' ? 'ownerpass123' : 'crewpass123',
  });
  return agent;
}

describe('write routes — crew scope', () => {
  it('lets crew create a trip (server derives the id) and reads it back', async () => {
    const agent = await loginAs('crew');
    const res = await agent.post('/api/trips').send({ date: '2024-08-10', title: 'Bay sail', body: 'Sunny.' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('t-2024-08-10');
    const got = await agent.get('/api/trips/t-2024-08-10');
    expect(got.status).toBe(200);
    expect(got.body.title).toBe('Bay sail');
    expect(got.body.body).toBe('Sunny.');
  });

  it('accepts a partial trip (date + body only)', async () => {
    const agent = await loginAs('crew');
    await agent.post('/api/trips').send({ date: '2024-08-11', body: 'Just a note.' }).expect(201);
  });

  it('lets crew edit a trip', async () => {
    const agent = await loginAs('crew');
    const res = await agent.put('/api/trips/t-2024-06-22').send({ title: 'Shakedown II' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Shakedown II');
  });

  it('lets crew mark maintenance complete but strips costEst from the response', async () => {
    const agent = await loginAs('crew');
    const res = await agent.post('/api/maintenance/m-jib-halyard/complete').send({ completed: '2024-07-05', note: 'Done.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completed).toBe('2024-07-05');
    expect('costEst' in res.body).toBe(false); // redaction-on-write
  });

  it('forbids crew from every owner-only write (403)', async () => {
    const agent = await loginAs('crew');
    await agent.post('/api/costs').send({ date: '2024-08-01', item: 'x', amount: 5 }).expect(403);
    await agent.post('/api/vendors').send({ name: 'x' }).expect(403);
    await agent.post('/api/inventory').send({ name: 'x' }).expect(403);
    await agent.post('/api/manuals').send({ title: 'x' }).expect(403);
    await agent.put('/api/maintenance/m-jib-halyard').send({ costEst: 1 }).expect(403); // full edit
    await agent.delete('/api/trips/t-2024-06-22').expect(403);
    await agent.delete('/api/maintenance/m-jib-halyard').expect(403);
  });
});

describe('write routes — owner CRUD', () => {
  it('lets owner create/update/delete across collections, keeping monetary fields', async () => {
    const agent = await loginAs('owner');

    const vendor = await agent.post('/api/vendors').send({ name: 'Rigging Pros', phone: '555-0100' });
    expect(vendor.status).toBe(201);
    expect(vendor.body.id).toBe('v-rigging-pros');

    const cost = await agent.post('/api/costs').send({ date: '2024-08-01', item: 'New shackle', amount: 42.5 });
    expect(cost.status).toBe(201);
    expect(cost.body.amount).toBe(42.5); // owner sees monetary

    const maint = await agent.post('/api/maintenance').send({ title: 'Bottom paint', status: 'scheduled', costEst: 300 });
    expect(maint.status).toBe(201);
    expect(maint.body.id).toBe('m-bottom-paint');
    expect(maint.body.costEst).toBe(300);

    const upd = await agent.put(`/api/maintenance/${maint.body.id}`).send({ priority: 2 });
    expect(upd.status).toBe(200);
    expect(upd.body.priority).toBe(2);

    await agent.delete(`/api/maintenance/${maint.body.id}`).expect(204);
    await agent.get(`/api/maintenance/${maint.body.id}`).expect(404);
  });

  it('404s update/delete/complete on an unknown id', async () => {
    const agent = await loginAs('owner');
    await agent.put('/api/trips/t-nope').send({ title: 'x' }).expect(404);
    await agent.delete('/api/vendors/v-nope').expect(404);
    await agent.post('/api/maintenance/m-nope/complete').send({}).expect(404);
  });

  it('rejects an invalid create with 400', async () => {
    const agent = await loginAs('owner');
    await agent.post('/api/trips').send({ date: 'someday' }).expect(400);
    await agent.post('/api/vendors').send({}).expect(400); // name required
  });

  it('suffixes a colliding id', async () => {
    const agent = await loginAs('owner');
    const a = await agent.post('/api/vendors').send({ name: 'Dock Shop' });
    const b = await agent.post('/api/vendors').send({ name: 'Dock Shop' });
    expect(a.body.id).toBe('v-dock-shop');
    expect(b.body.id).toBe('v-dock-shop-2');
  });
});

describe('write routes — guards', () => {
  it('requires auth (guest = 401)', async () => {
    const { app } = await buildTestApp();
    await request(app).post('/api/trips').send({ date: '2024-08-01' }).expect(401);
    await request(app).post('/api/photos').expect(401);
  });

  it('disables every write in demo mode (403)', async () => {
    const { app } = await buildTestApp({ demo: true });
    await request(app).post('/api/trips').send({ date: '2024-08-01' }).expect(403);
    await request(app).post('/api/maintenance/m-jib-halyard/complete').send({}).expect(403);
    await request(app).post('/api/vendors').send({ name: 'x' }).expect(403);
    await request(app).delete('/api/trips/t-2024-06-22').expect(403);
    await request(app).post('/api/photos').expect(403);
  });
});

describe('photo upload', () => {
  it('accepts an image, compresses it, and returns a repo-relative ref', async () => {
    const agent = await loginAs('crew');
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 5, g: 90, b: 150 } } }).png().toBuffer();
    const res = await agent.post('/api/photos').attach('photo', png, { filename: 'sail.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.ref).toMatch(/^photos\/[0-9a-f]{12}\.jpg$/);
  });

  it('rejects an unsupported image type (415)', async () => {
    const agent = await loginAs('crew');
    const res = await agent.post('/api/photos').attach('photo', Buffer.from('GIF89a'), { filename: 'x.gif', contentType: 'image/gif' });
    expect(res.status).toBe(415);
  });

  it('rejects a wrong multipart field name with 400 (not 500)', async () => {
    const agent = await loginAs('crew');
    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    // The route expects field "photo"; sending "wrong" triggers a MulterError → 400.
    const res = await agent.post('/api/photos').attach('wrong', png, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });
});
