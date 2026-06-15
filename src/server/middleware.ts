import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { verifyToken, SESSION_COOKIE, type Session } from './session.js';
import type { Role } from './redact.js';
import type { Config } from './config.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      viewer: { role: Role; username: string | null };
    }
  }
}

/** Resolve the requester's role: demo => owner; valid cookie => its role; else guest. */
export function attachRole(config: Config, now: () => Date): RequestHandler {
  return (req, _res, next) => {
    if (config.demo) {
      req.viewer = { role: 'owner', username: null };
      return next();
    }
    const session: Session | null = verifyToken(
      req.cookies?.[SESSION_COOKIE],
      config.sessionSecret,
      now(),
      config.sessionTtlMs,
    );
    req.viewer = session
      ? { role: session.role, username: session.username }
      : { role: 'guest', username: null };
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.viewer.role === 'guest') {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.viewer.role !== 'owner') {
    res.status(403).json({ error: 'owner only' });
    return;
  }
  next();
}

export function loginLimiter(config: Config): RequestHandler {
  return rateLimit({
    windowMs: config.login.windowMs,
    limit: () => config.login.max, // a function, read live, so a test can tighten the limit after the app is built
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
}
