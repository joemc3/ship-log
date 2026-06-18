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
import type { AssistantClient } from './assistant.js';
import type { ChatLog } from './chatlog.js';
import { attachRole } from './middleware.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDataRoutes } from './routes/data.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerWriteRoutes } from './routes/writes.js';
import { registerPhotoRoute, registerManualRoute, registerWelcomeHeroRoute, registerSpaStatic } from './static.js';
import { registerAssistantRoutes } from './routes/assistant.js';

export interface AssistantDeps {
  client: AssistantClient;
  log: ChatLog;
  sessionId: string;
  label: string;
}

export interface AppContext {
  config: Config;
  store: ShipStore;
  users: UsersStore;
  now: () => Date;
  assistant?: AssistantDeps;
}

/** ~1 year, the value HSTS preload lists expect. */
const HSTS_MAX_AGE = 31_536_000;

/**
 * Content-Security-Policy for the same-origin Vite/React SPA. Everything is served
 * from the app's own origin, so the base policy is `'self'`. Notes:
 *  - `script-src 'self'`: the built bundle is same-origin JS; no inline scripts.
 *  - `style-src 'self' 'unsafe-inline' fonts.googleapis.com`: Vite/React inject a
 *    few inline styles, and index.html loads the Google Fonts stylesheet (Spectral
 *    + IBM Plex). `'unsafe-inline'` is for styles only (NOT scripts).
 *  - `font-src 'self' fonts.gstatic.com`: the Google Fonts web-font files.
 *  - `img-src 'self' data:`: photos are same-origin, plus inline `data:` thumbnails.
 *  - `connect-src 'self'`: the SPA only talks to its own /api.
 *  - `frame-ancestors 'none'` + `object-src 'none'`: anti-clickjacking / no plugins.
 *  - `upgrade-insecure-requests` is appended ONLY behind TLS (production) so it
 *    never forces https on a plain-http localhost dev server.
 */
function contentSecurityPolicy(tls: boolean): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    // index.html loads the Google Fonts stylesheet (Spectral + IBM Plex); allow it
    // and its web-font files, or the design silently falls back to system fonts.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (tls) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/**
 * Hardening headers on every response, config-aware:
 *  - `X-Content-Type-Options: nosniff` — always.
 *  - `Content-Security-Policy` — always (the SPA is same-origin in every mode);
 *    `upgrade-insecure-requests` is added only when behind TLS.
 *  - `Strict-Transport-Security` — ONLY behind TLS (COOKIE_SECURE=true and not
 *    demo). Sending HSTS over plain http would pin a localhost/dev browser to
 *    https and break local dev, so it stays off there.
 *
 * "Behind TLS" is inferred from `cookieSecure` (true in the Pangolin-tunnel VPS
 * shape) AND not-demo (demo is always plain http with no tunnel).
 */
function hardeningHeaders(config: Config): (req: Request, res: Response, next: NextFunction) => void {
  const tls = config.cookieSecure && !config.demo;
  const csp = contentSecurityPolicy(tls);
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', csp);
    if (tls) {
      res.setHeader('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE}; includeSubDomains`);
    }
    next();
  };
}

/** Build the Express app from injected deps. `now` defaults to the real clock;
 *  tests inject a fixed clock so derived views stay deterministic. */
export function createApp(deps: Omit<AppContext, 'now'> & { now?: () => Date }): Express {
  const ctx: AppContext = { ...deps, now: deps.now ?? (() => new Date()) };
  const app = express();
  app.disable('x-powered-by');
  app.use(hardeningHeaders(ctx.config));
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachRole(ctx.config, ctx.now));
  registerAuthRoutes(app, ctx);
  registerDataRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerWriteRoutes(app, ctx);
  registerPhotoRoute(app, ctx);
  registerManualRoute(app, ctx);
  registerWelcomeHeroRoute(app, ctx);
  registerAssistantRoutes(app, ctx);

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
