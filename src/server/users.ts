import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hash, verify } from '@node-rs/argon2';

export type UserRole = 'owner' | 'crew';
export interface UserRecord { username: string; role: UserRole; hash: string; }
export interface PublicUser { username: string; role: UserRole; }

/**
 * File-backed users store (a small `users.json` of hashed credentials). Lives in
 * a VPS volume OUTSIDE the git data repo. Passwords are argon2id-hashed
 * (@node-rs/argon2's default variant) and never returned or logged.
 */
export class UsersStore {
  private constructor(
    private readonly path: string,
    private readonly users: Map<string, UserRecord>,
  ) {}

  static async load(path: string): Promise<UsersStore> {
    let users = new Map<string, UserRecord>();
    try {
      const arr = JSON.parse(await readFile(path, 'utf8')) as UserRecord[];
      users = new Map(arr.map((u) => [u.username, u]));
    } catch (err) {
      // A missing file = an empty store (first boot). Anything else is real.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return new UsersStore(path, users);
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify([...this.users.values()], null, 2));
  }

  isEmpty(): boolean { return this.users.size === 0; }
  ownerCount(): number { return [...this.users.values()].filter((u) => u.role === 'owner').length; }
  list(): PublicUser[] { return [...this.users.values()].map(({ username, role }) => ({ username, role })); }
  get(username: string): UserRecord | undefined { return this.users.get(username); }

  async verify(username: string, password: string): Promise<PublicUser | null> {
    const u = this.users.get(username);
    if (!u) return null;
    if (!(await verify(u.hash, password))) return null;
    return { username: u.username, role: u.role };
  }

  async add(username: string, password: string, role: UserRole): Promise<void> {
    if (this.users.has(username)) throw new Error(`user already exists: ${username}`);
    this.users.set(username, { username, role, hash: await hash(password) });
    await this.persist();
  }

  async setPassword(username: string, password: string): Promise<void> {
    const u = this.users.get(username);
    if (!u) throw new Error(`no such user: ${username}`);
    u.hash = await hash(password);
    await this.persist();
  }

  async setRole(username: string, role: UserRole): Promise<void> {
    const u = this.users.get(username);
    if (!u) throw new Error(`no such user: ${username}`);
    if (u.role === 'owner' && role !== 'owner' && this.ownerCount() === 1) {
      throw new Error('cannot demote the last owner');
    }
    u.role = role;
    await this.persist();
  }

  async remove(username: string): Promise<void> {
    const u = this.users.get(username);
    if (!u) return;
    if (u.role === 'owner' && this.ownerCount() === 1) {
      throw new Error('cannot delete the last owner');
    }
    this.users.delete(username);
    await this.persist();
  }

  async changePassword(username: string, current: string, next: string): Promise<void> {
    const u = this.users.get(username);
    if (!u || !(await verify(u.hash, current))) throw new Error('invalid current password');
    u.hash = await hash(next);
    await this.persist();
  }

  async bootstrapOwner(username: string, password: string): Promise<void> {
    if (!this.isEmpty()) return;
    await this.add(username, password, 'owner');
  }
}
