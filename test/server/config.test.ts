import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/server/config.js';

const DEMO = '/tmp/demo-placeholder';

/** Write `value` into a throwaway secret file and return its path (mirrors how
 *  Docker mounts a secret at /run/secrets/<name>). */
function secretFile(value: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'shiplog-secret-')), 'secret');
  writeFileSync(path, value);
  return path;
}

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

  it('leaves sync fields undefined by default', () => {
    const c = loadConfig({ DATA_DIR: '/d', SESSION_SECRET: 's' }, DEMO);
    expect(c.dataRepoUrl).toBeUndefined();
    expect(c.sshKeyPath).toBeUndefined();
    expect(c.repoToken).toBeUndefined();
  });

  it('reads DATA_REPO_URL and the two credential paths', () => {
    const c = loadConfig(
      {
        DATA_DIR: '/d',
        SESSION_SECRET: 's',
        DATA_REPO_URL: 'git@github.com:me/boat-data.git',
        DATA_SSH_KEY_PATH: '/run/secrets/deploy_key',
        DATA_REPO_TOKEN: 'ghp_xxx',
      },
      DEMO,
    );
    expect(c.dataRepoUrl).toBe('git@github.com:me/boat-data.git');
    expect(c.sshKeyPath).toBe('/run/secrets/deploy_key');
    expect(c.repoToken).toBe('ghp_xxx');
  });

  it('allows DATA_REPO_URL in demo-less boot but stays demo with neither DATA_DIR nor DATA_REPO_URL', () => {
    // DATA_REPO_URL alone (no DATA_DIR) is still a configured deployment, not demo.
    expect(() => loadConfig({ DATA_REPO_URL: 'file:///tmp/x' }, DEMO)).toThrow(/SESSION_SECRET/);
    const configured = loadConfig({ DATA_REPO_URL: 'file:///tmp/x', SESSION_SECRET: 's' }, DEMO);
    expect(configured.demo).toBe(false);
    expect(configured.dataRepoUrl).toBe('file:///tmp/x');
    // Neither set ⇒ demo.
    expect(loadConfig({}, DEMO).demo).toBe(true);
  });

  it('defaults PULL_INTERVAL to 5 minutes and reads it (in seconds) when set', () => {
    expect(loadConfig({ DATA_DIR: '/d', SESSION_SECRET: 's' }, DEMO).pullIntervalMs).toBe(5 * 60 * 1000);
    expect(loadConfig({ DATA_DIR: '/d', SESSION_SECRET: 's', PULL_INTERVAL: '30' }, DEMO).pullIntervalMs).toBe(30_000);
  });

  describe('users-store-volume invariant (USERS_PATH must stay OUTSIDE DATA_DIR)', () => {
    it('throws when USERS_PATH resolves inside DATA_DIR', () => {
      expect(() =>
        loadConfig({ DATA_DIR: '/srv/data', SESSION_SECRET: 's', USERS_PATH: '/srv/data/users.json' }, DEMO),
      ).toThrow(/USERS_PATH/);
    });

    it('throws when USERS_PATH is nested deeper inside DATA_DIR', () => {
      expect(() =>
        loadConfig({ DATA_DIR: '/srv/data', SESSION_SECRET: 's', USERS_PATH: '/srv/data/sub/dir/users.json' }, DEMO),
      ).toThrow(/USERS_PATH/);
    });

    it('throws when USERS_PATH reaches inside DATA_DIR via a relative ../ path', () => {
      expect(() =>
        loadConfig(
          { DATA_DIR: '/srv/data', SESSION_SECRET: 's', USERS_PATH: '/srv/data/../data/users.json' },
          DEMO,
        ),
      ).toThrow(/USERS_PATH/);
    });

    it('allows the default ./var/users.json (outside the default ./var/data clone dir)', () => {
      // DATA_REPO_URL with no DATA_DIR ⇒ clone dir is ./var/data; default users path
      // is ./var/users.json — a SIBLING, not inside it.
      const c = loadConfig({ DATA_REPO_URL: 'file:///tmp/x', SESSION_SECRET: 's' }, DEMO);
      expect(c.usersPath).toBeDefined();
      expect(c.dataDir).toBe('./var/data');
    });

    it('allows an explicit USERS_PATH outside DATA_DIR', () => {
      const c = loadConfig(
        { DATA_DIR: '/srv/data', SESSION_SECRET: 's', USERS_PATH: '/srv/state/users.json' },
        DEMO,
      );
      expect(c.usersPath).toBe('/srv/state/users.json');
    });

    it('does not flag a sibling dir that merely shares a name prefix with DATA_DIR', () => {
      // /srv/data-backup is NOT inside /srv/data even though it shares the prefix.
      const c = loadConfig(
        { DATA_DIR: '/srv/data', SESSION_SECRET: 's', USERS_PATH: '/srv/data-backup/users.json' },
        DEMO,
      );
      expect(c.usersPath).toBe('/srv/data-backup/users.json');
    });

    it('does not apply the guard in demo mode (no DATA_DIR clone to protect)', () => {
      const c = loadConfig({ USERS_PATH: '/tmp/anywhere/users.json' }, DEMO);
      expect(c.demo).toBe(true);
      expect(c.usersPath).toBe('/tmp/anywhere/users.json');
    });
  });

  describe('Docker-secret *_FILE indirection (VPS secret-file mode)', () => {
    it('reads SESSION_SECRET from SESSION_SECRET_FILE and trims trailing newline', () => {
      const file = secretFile('super-secret-value\n');
      const c = loadConfig({ DATA_DIR: '/d', SESSION_SECRET_FILE: file }, DEMO);
      expect(c.sessionSecret).toBe('super-secret-value');
    });

    it('reads the owner-bootstrap password from OWNER_PASSWORD_FILE', () => {
      const file = secretFile('hunter2-from-secret\n');
      const c = loadConfig(
        { DATA_DIR: '/d', SESSION_SECRET: 's', OWNER_USERNAME: 'cap', OWNER_PASSWORD_FILE: file },
        DEMO,
      );
      expect(c.ownerBootstrap).toEqual({ username: 'cap', password: 'hunter2-from-secret' });
    });

    it('reads DATA_REPO_TOKEN from DATA_REPO_TOKEN_FILE', () => {
      const file = secretFile('ghp_tokenfromfile\n');
      const c = loadConfig({ DATA_DIR: '/d', SESSION_SECRET: 's', DATA_REPO_TOKEN_FILE: file }, DEMO);
      expect(c.repoToken).toBe('ghp_tokenfromfile');
    });

    it('prefers the inline env var over the *_FILE form when both are set', () => {
      const file = secretFile('from-file');
      const c = loadConfig({ DATA_DIR: '/d', SESSION_SECRET: 'inline-wins', SESSION_SECRET_FILE: file }, DEMO);
      expect(c.sessionSecret).toBe('inline-wins');
    });

    it('throws a clear error when a *_FILE path does not exist', () => {
      expect(() =>
        loadConfig({ DATA_DIR: '/d', SESSION_SECRET_FILE: '/no/such/secret/file' }, DEMO),
      ).toThrow(/SESSION_SECRET_FILE/);
    });
  });
});
