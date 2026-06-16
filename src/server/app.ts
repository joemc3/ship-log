import express, {
  type Express,
  type ErrorRequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cookieParser from 'cookie-parser';
import type { Config } from './config.js';
import type { UsersStore } from './users.js';
import type { ShipStore } from './store.js';
import { attachRole } from './middleware.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDataRoutes } from './routes/data.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerWriteRoutes } from './routes/writes.js';
import { registerPhotoRoute, registerManualRoute, registerSpaStatic } from './static.js';

export interface AppContext {
  config: Config;
  store: ShipStore;
  users: UsersStore;
  now: () => Date;
}

/** Basic hardening header on every response. */
function noSniff(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

/** Build the Express app from injected deps. `now` defaults to the real clock;
 *  tests inject a fixed clock so derived views stay deterministic. */
export function createApp(deps: Omit<AppContext, 'now'> & { now?: () => Date }): Express {
  const ctx: AppContext = { ...deps, now: deps.now ?? (() => new Date()) };
  const app = express();
  app.disable('x-powered-by');
  app.use(noSniff);
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachRole(ctx.config, ctx.now));
  registerAuthRoutes(app, ctx);
  registerDataRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerWriteRoutes(app, ctx);
  registerPhotoRoute(app, ctx);
  registerManualRoute(app, ctx);

  // Any unmatched /api, /photos, or /files path -> JSON 404. Registered BEFORE
  // the SPA so an unknown API/asset route is always a JSON 404, never index.html.
  app.use(['/api', '/photos', '/files'], (_req, res) => { res.status(404).json({ error: 'not found' }); });

  // Built SPA (dist/ui) with history-fallback for every other route. No-op when
  // no client build is configured. It explicitly ignores /api + /photos.
  registerSpaStatic(app, ctx);

  // Final catch-all for anything the SPA didn't serve (e.g. no client build):
  // keep the surface JSON-only.
  app.use((_req, res) => { res.status(404).json({ error: 'not found' }); });

  // Global JSON error handler (must be registered last).
  const jsonErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : 500;
    res.status(status).json({ error: status >= 400 && status < 500 ? 'invalid request' : 'internal error' });
  };
  app.use(jsonErrorHandler);
  return app;
}
