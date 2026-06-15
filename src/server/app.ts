import express, {
  type Express,
  type ErrorRequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cookieParser from 'cookie-parser';
import type { Dataset } from '../data/index.js';
import type { Config } from './config.js';
import type { UsersStore } from './users.js';
import { attachRole } from './middleware.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDataRoutes } from './routes/data.js';
import { registerAdminRoutes } from './routes/admin.js';

export interface AppContext {
  config: Config;
  dataset: Dataset;
  users: UsersStore;
  now: () => Date;
}

/** Basic hardening header on every response. */
function noSniff(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

/** Build the Express app from injected deps. `now` defaults to the real clock;
 *  tests inject a fixed clock so derived views are deterministic. */
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

  // Unmatched route -> JSON 404 (keeps the API JSON-only). Must be after all routes,
  // before the error handler.
  app.use((_req, res) => { res.status(404).json({ error: 'not found' }); });

  // Global JSON error handler (must be registered last). Keeps responses JSON even
  // on a malformed body or an unexpected throw; never leaks a stack trace.
  const jsonErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : 500;
    res.status(status).json({ error: status >= 400 && status < 500 ? 'invalid request' : 'internal error' });
  };
  app.use(jsonErrorHandler);
  return app;
}
