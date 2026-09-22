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

  it('verifies a username regardless of case and surrounding whitespace', async () => {
    // A phone keyboard capitalises the first letter of a text field, and
    // autocomplete appends a space. Neither should lock a crew member out.
    const store = await UsersStore.load(path);
    await store.add('tyler', 'crewpass123', 'crew');
    expect(await store.verify('Tyler', 'crewpass123')).toEqual({ username: 'tyler', role: 'crew' });
    expect(await store.verify('TYLER', 'crewpass123')).toEqual({ username: 'tyler', role: 'crew' });
    expect(await store.verify('  tyler ', 'crewpass123')).toEqual({ username: 'tyler', role: 'crew' });
    // The stored spelling is what the session carries, not what was typed.
    expect((await store.verify('Tyler', 'crewpass123'))?.username).toBe('tyler');
    // The password itself is still exact.
    expect(await store.verify('Tyler', 'CREWPASS123')).toBeNull();
  });

  it('an exact match wins over a case-insensitive one when both exist', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    // Legacy data could hold two users differing only by case; be deterministic.
    (store as unknown as { users: Map<string, unknown> }).users.set('Cap', { username: 'Cap', role: 'crew', hash: 'x' });
    expect((await store.verify('cap', 'ownerpass123'))?.username).toBe('cap');
  });

  it('refuses to add a username that differs from an existing one only by case or spacing', async () => {
    const store = await UsersStore.load(path);
    await store.add('tyler', 'crewpass123', 'crew');
    await expect(store.add('Tyler', 'otherpass123', 'crew')).rejects.toThrow(/already exists/);
    await expect(store.add(' tyler ', 'otherpass123', 'crew')).rejects.toThrow(/already exists/);
    expect(store.list().map((u) => u.username)).toEqual(['tyler']);
  });

  it('stores a new username trimmed', async () => {
    const store = await UsersStore.load(path);
    await store.add('  gage ', 'crewpass123', 'crew');
    expect(store.list().map((u) => u.username)).toEqual(['gage']);
    expect(await store.verify('gage', 'crewpass123')).toEqual({ username: 'gage', role: 'crew' });
  });

  it('never exposes the password hash via list()', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    expect(JSON.stringify(store.list())).not.toMatch(/argon2|\$/);
  });

  it('get() returns a hash-free public user, or undefined when absent', async () => {
    const store = await UsersStore.load(path);
    await store.add('cap', 'ownerpass123', 'owner');
    const found = store.get('cap');
    expect(found).toEqual({ username: 'cap', role: 'owner' });
    expect(JSON.stringify(found)).not.toMatch(/argon2|\$/);
    expect(store.get('ghost')).toBeUndefined();
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
