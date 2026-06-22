import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/server/config.js';
import { UsersStore } from '../../src/server/users.js';
import { createApp } from '../../src/server/app.js';
import { ShipStore } from '../../src/server/store.js';
import type { ConditionsService } from '../../src/server/conditions/service.js';
import { FIXED_NOW, DEMO } from './helpers.js';

async function appOverDemo(conditions?: ConditionsService) {
  const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
  const config = loadConfig({ USERS_PATH: usersPath }, DEMO); // demo mode (public, read-only)
  const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW, sync: false });
  const users = await UsersStore.load(usersPath);
  const app = createApp({ config, store, users, now: FIXED_NOW, conditions });
  return app;
}

describe('GET /api/conditions', () => {
  it('is public and serves agent-mode readings straight from the demo file', async () => {
    const app = await appOverDemo();
    const res = await request(app).get('/api/conditions'); // no auth
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.source).toBe('agent');
    expect(res.body.location.label).toBe('Charleston Harbor entrance');
    expect(res.body.weather.periods.length).toBeGreaterThan(0);
    expect(res.body.tides.predictions['8665530'][0].type).toBe('H');
    expect(res.body.body).toContain('sea breeze');
  });

  it('returns configured:false when no conditions.md exists', async () => {
    // A data dir with only a boat.yaml (non-demo, no git needed for a read).
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-bare-'));
    writeFileSync(join(dir, 'boat.yaml'), 'name: Test\n');
    const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
    const config = loadConfig({ DATA_DIR: dir, SESSION_SECRET: 's', COOKIE_SECURE: 'false', USERS_PATH: usersPath }, DEMO);
    const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW, sync: false });
    const users = await UsersStore.load(usersPath);
    const app = createApp({ config, store, users, now: FIXED_NOW });
    const res = await request(app).get('/api/conditions');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });

  it('api mode: merges live readings from the injected service', async () => {
    // Build a non-demo data dir whose conditions.md is api mode.
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-api-'));
    await cp(DEMO, dir, { recursive: true });
    writeFileSync(join(dir, 'conditions.md'),
      '---\nsource: api\nlocation:\n  label: "Charleston"\n  lat: 32.78\n  lon: -79.93\n' +
      'tides:\n  stations:\n    - { id: "8665530", name: "Charleston", primary: true }\n---\n');
    const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
    const config = loadConfig({ DATA_DIR: dir, SESSION_SECRET: 's', COOKIE_SECURE: 'false', USERS_PATH: usersPath }, DEMO);
    const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW, sync: false });
    const users = await UsersStore.load(usersPath);

    const fakeService: ConditionsService = {
      get: vi.fn(async () => ({
        periods: [{ time: '2026-06-20T14:00:00Z', windKt: 11 }],
        predictions: { '8665530': [{ type: 'H' as const, time: '2026-06-20T15:12:00Z', heightFt: 5.8 }] },
        asOf: '2026-06-20T13:00:00Z',
        errored: false,
      })),
    };
    const app = createApp({ config, store, users, now: FIXED_NOW, conditions: fakeService });
    const res = await request(app).get('/api/conditions');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('api');
    expect(res.body.weather.periods[0].windKt).toBe(11);
    expect(res.body.tides.stations[0].id).toBe('8665530');
    expect(fakeService.get).toHaveBeenCalledTimes(1);
  });

  it('api mode with CONDITIONS_FETCH=false degrades to unavailable without calling the service', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shiplog-ks-'));
    await cp(DEMO, dir, { recursive: true });
    writeFileSync(join(dir, 'conditions.md'),
      '---\nsource: api\nlocation:\n  label: "Charleston"\n  lat: 32.78\n  lon: -79.93\n' +
      'tides:\n  stations:\n    - { id: "8665530", name: "Charleston", primary: true }\n---\n');
    const usersPath = join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
    const config = loadConfig({ DATA_DIR: dir, SESSION_SECRET: 's', COOKIE_SECURE: 'false', CONDITIONS_FETCH: 'false', USERS_PATH: usersPath }, DEMO);
    const store = await ShipStore.open(config.dataDir, { now: FIXED_NOW, sync: false });
    const users = await UsersStore.load(usersPath);
    const get = vi.fn();
    const app = createApp({ config, store, users, now: FIXED_NOW, conditions: { get } });
    const res = await request(app).get('/api/conditions');
    expect(res.status).toBe(200);
    expect(res.body.error).toBe('unavailable');
    expect(res.body.stale).toBe(true);
    expect(res.body.tides.stations[0].id).toBe('8665530'); // config still surfaces
    expect(get).not.toHaveBeenCalled();
  });
});
