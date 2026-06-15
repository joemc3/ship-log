import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsersStore } from '../../src/server/users.js';

function tmpUsersPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'shiplog-users-')), 'users.json');
}

describe('UsersStore', () => {
  let path: string;
  beforeEach(() => { path = tmpUsersPath(); });

  it('starts empty and bootstraps a single owner', async () => {
    const store = await UsersStore.load(path);
    expect(store.isEmpty()).toBe(true);
    await store.bootstrapOwner('cap', 'ownerpass123');
    expect(store.isEmpty()).toBe(false);
    expect(store.list()).toEqual([{ username: 'cap', role: 'owner' }]);
  });

  it('bootstrap is a no-op once a user exists', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    await store.bootstrapOwner('intruder', 'x');
    expect(store.list().map((u) => u.username)).toEqual(['cap']);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    expect(await store.verify('cap', 'ownerpass123')).toEqual({ username: 'cap', role: 'owner' });
    expect(await store.verify('cap', 'wrong')).toBeNull();
    expect(await store.verify('ghost', 'whatever')).toBeNull();
  });

  it('never exposes the password hash via list()', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    expect(JSON.stringify(store.list())).not.toMatch(/argon2|\$/);
  });

  it('changePassword requires the correct current password', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    await expect(store.changePassword('cap', 'wrong', 'newpass123')).rejects.toThrow();
    await store.changePassword('cap', 'ownerpass123', 'newpass123');
    expect(await store.verify('cap', 'newpass123')).not.toBeNull();
  });

  it('guards the last owner against deletion and demotion', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    await store.add('deck', 'crewpass123', 'crew');
    await expect(store.remove('cap')).rejects.toThrow(/last owner/);
    await expect(store.setRole('cap', 'crew')).rejects.toThrow(/last owner/);
    await store.add('mate', 'ownerpass123', 'owner');
    await store.remove('cap'); // now allowed — another owner remains
    expect(store.ownerCount()).toBe(1);
  });

  it('persists across reloads', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    const reloaded = await UsersStore.load(path);
    expect(await reloaded.verify('cap', 'ownerpass123')).toEqual({ username: 'cap', role: 'owner' });
  });
});
