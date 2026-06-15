import type { Express } from 'express';
import type { AppContext } from '../app.js';
import { requireOwner } from '../middleware.js';
import type { UserRole } from '../users.js';

function validRole(r: unknown): r is UserRole {
  return r === 'owner' || r === 'crew';
}

export function registerAdminRoutes(app: Express, ctx: AppContext): void {
  const { users } = ctx;

  app.get('/api/users', requireOwner, (_req, res) => res.json(users.list()));

  app.post('/api/users', requireOwner, async (req, res) => {
    const { username, password, role } = req.body ?? {};
    if (typeof username !== 'string' || username.length < 1 ||
        typeof password !== 'string' || password.length < 8 || !validRole(role)) {
      res.status(400).json({ error: 'username, password (min 8 chars), role (owner|crew) required' });
      return;
    }
    try {
      await users.add(username, password, role);
    } catch {
      res.status(409).json({ error: 'user already exists' });
      return;
    }
    res.status(201).json({ username, role });
  });

  app.put('/api/users/:username', requireOwner, async (req, res) => {
    const target = req.params.username as string;
    if (!users.get(target)) { res.status(404).json({ error: 'no such user' }); return; }
    const { role, password } = req.body ?? {};
    try {
      if (role !== undefined) {
        if (!validRole(role)) { res.status(400).json({ error: 'role must be owner|crew' }); return; }
        await users.setRole(target, role);
      }
      if (password !== undefined) {
        if (typeof password !== 'string' || password.length < 8) {
          res.status(400).json({ error: 'password must be at least 8 chars' });
          return;
        }
        await users.setPassword(target, password);
      }
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
      return;
    }
    res.status(204).end();
  });

  app.delete('/api/users/:username', requireOwner, async (req, res) => {
    try {
      await users.remove(req.params.username as string);
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
      return;
    }
    res.status(204).end();
  });
}
