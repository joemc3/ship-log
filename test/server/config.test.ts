import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/server/config.js';

const DEMO = '/tmp/demo-placeholder';

describe('loadConfig', () => {
  it('enters demo mode when DATA_DIR is unset and uses the demo dir', () => {
    const c = loadConfig({}, DEMO);
    expect(c.demo).toBe(true);
    expect(c.dataDir).toBe(DEMO);
  });

  it('is non-demo when DATA_DIR is set, and requires SESSION_SECRET', () => {
    expect(() => loadConfig({ DATA_DIR: '/data' }, DEMO)).toThrow(/SESSION_SECRET/);
    const c = loadConfig({ DATA_DIR: '/data', SESSION_SECRET: 's' }, DEMO);
    expect(c.demo).toBe(false);
    expect(c.dataDir).toBe('/data');
    expect(c.sessionSecret).toBe('s');
  });

  it('reads owner-bootstrap when both username and password are present', () => {
    const c = loadConfig({ DATA_DIR: '/data', SESSION_SECRET: 's', OWNER_USERNAME: 'cap', OWNER_PASSWORD: 'pw' }, DEMO);
    expect(c.ownerBootstrap).toEqual({ username: 'cap', password: 'pw' });
  });

  it('leaves owner-bootstrap undefined when only one credential is present', () => {
    const c = loadConfig({ DATA_DIR: '/data', SESSION_SECRET: 's', OWNER_USERNAME: 'cap' }, DEMO);
    expect(c.ownerBootstrap).toBeUndefined();
  });

  it('defaults cookieSecure true but honors COOKIE_SECURE=false (case-insensitive)', () => {
    expect(loadConfig({ DATA_DIR: '/d', SESSION_SECRET: 's' }, DEMO).cookieSecure).toBe(true);
    expect(loadConfig({ DATA_DIR: '/d', SESSION_SECRET: 's', COOKIE_SECURE: 'false' }, DEMO).cookieSecure).toBe(false);
    expect(loadConfig({ DATA_DIR: '/d', SESSION_SECRET: 's', COOKIE_SECURE: 'FALSE' }, DEMO).cookieSecure).toBe(false);
  });
});
