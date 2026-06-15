import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { Dataset } from '../data/index.js';
import type { Config } from './config.js';
import type { UsersStore } from './users.js';
import { attachRole } from './middleware.js';
import { registerAuthRoutes } from './routes/auth.js';

export interface AppContext {
  config: Config;
  dataset: Dataset;
  users: UsersStore;
  now: () => Date;
}

/** Build the Express app from injected deps. `now` defaults to the real clock;
 *  tests inject a fixed clock so derived views are deterministic. */
export function createApp(deps: Omit<AppContext, 'now'> & { now?: () => Date }): Express {
  const ctx: AppContext = { ...deps, now: deps.now ?? (() => new Date()) };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachRole(ctx.config, ctx.now));
  registerAuthRoutes(app, ctx);
  return app;
}
