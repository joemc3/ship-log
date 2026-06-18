import type { Express } from 'express';
import type { AppContext } from '../app.js';
import type { ShipStore } from '../store.js';
import { createToken, SESSION_COOKIE } from '../session.js';
import { requireAuth, loginLimiter } from '../middleware.js';

/** Client-safe sync summary for `/api/me`: status + timestamps + the enabled bit,
 *  but NEVER the error reason (that stays on the dedicated `/api/sync` endpoint and
 *  is generic even there). */
function syncSummary(store: ShipStore): { status: string; enabled: boolean; lastPullAt?: Date; lastPushAt?: Date } {
  const s = store.syncState();
  return { status: s.status, enabled: store.syncEnabled(), lastPullAt: s.lastPullAt, lastPushAt: s.lastPushAt };
}

/** Client-safe assistant summary for `/api/me`: whether the feature is on + the
 *  UI label. No URL/secret ever crosses the wire. */
function assistantSummary(assistant: AppContext['assistant']): { enabled: boolean; label: string } {
  return { enabled: !!assistant, label: assistant?.label ?? 'Ask the Purser' };
}

export function registerAuthRoutes(app: Express, ctx: AppContext): void {
  const { config, store, users, now, assistant } = ctx;

  // Public (guest-visible) endpoint: boat identity + welcome block ONLY, no
  // collections. Explicitly curate the returned fields — do NOT spread
  // store.current().boat — so adding a field to boat.yaml can never leak it to
  // unauthenticated callers.
  app.get('/api/welcome', (_req, res) => {
    const { name, make, model, year, hailingPort, heroPhoto, welcome } = store.current().boat;
    res.json({ name, make, model, year, hailingPort, heroPhoto, welcome: welcome ?? {} });
  });

  app.get('/api/me', (req, res) => {
    // Authenticated viewers (and demo, which is owner-equivalent) get a light sync
    // summary so the SPA can banner a conflict/offline state. Guests never do.
    const showSync = config.demo || req.viewer.role !== 'guest';
    res.json({
      role: req.viewer.role,
      username: req.viewer.username,
      demo: config.demo,
      ownerConfigured: !users.isEmpty(),
      ...(showSync ? { sync: syncSummary(store), assistant: assistantSummary(assistant) } : {}),
    });
  });

  // Dedicated sync endpoint (authenticated; demo is owner-equivalent so it passes
  // requireAuth). Guests get 401 — they never see sync internals. Carries the
  // GENERIC, sanitized reason in addition to the summary; still no remote URL/path.
  app.get('/api/sync', requireAuth, (_req, res) => {
    const s = store.syncState();
    res.json({
      status: s.status,
      enabled: store.syncEnabled(),
      lastPullAt: s.lastPullAt,
      lastPushAt: s.lastPushAt,
      lastError: s.lastError,
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
