import type { Express } from 'express';
import type { AppContext } from '../app.js';
import { createToken, SESSION_COOKIE } from '../session.js';
import { requireAuth, loginLimiter } from '../middleware.js';

export function registerAuthRoutes(app: Express, ctx: AppContext): void {
  const { config, dataset, users, now } = ctx;

  // Public: boat identity + welcome block ONLY (guest-visible). No collections.
  app.get('/api/welcome', (_req, res) => {
    // Public endpoint: explicitly curate the fields — do NOT spread `dataset.boat`,
    // which would leak `specs` and any future boat fields to guests.
    const { name, make, model, year, hailingPort, welcome } = dataset.boat;
    res.json({ name, make, model, year, hailingPort, welcome: welcome ?? {} });
  });

  app.get('/api/me', (req, res) => {
    res.json({
      role: req.viewer.role,
      username: req.viewer.username,
      demo: config.demo,
      ownerConfigured: !users.isEmpty(),
    });
  });

  app.post('/api/login', loginLimiter(config), async (req, res) => {
    if (config.demo) { res.status(400).json({ error: 'login disabled in demo mode' }); return; }
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'username and password required' });
      return;
    }
    const user = await users.verify(username, password);
    if (!user) { res.status(401).json({ error: 'invalid credentials' }); return; }
    const token = createToken({ username: user.username, role: user.role }, config.sessionSecret, now());
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: config.sessionTtlMs,
    });
    res.json({ username: user.username, role: user.role });
  });

  app.post('/api/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/',
    });
    res.status(204).end();
  });

  app.post('/api/password', requireAuth, async (req, res) => {
    if (config.demo) { res.status(400).json({ error: 'disabled in demo mode' }); return; }
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
      res.status(400).json({ error: 'currentPassword and newPassword (min 8 chars) required' });
      return;
    }
    try {
      await users.changePassword(req.viewer.username!, currentPassword, newPassword);
    } catch {
      res.status(400).json({ error: 'invalid current password' });
      return;
    }
    res.status(204).end();
  });
}
