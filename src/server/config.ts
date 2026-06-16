import { z } from 'zod';

export interface Config {
  dataDir: string;       // resolved data directory (the demo dir when in demo mode)
  demo: boolean;         // true when no DATA_DIR was configured
  sessionSecret: string;
  usersPath: string;
  port: number;
  cookieSecure: boolean;
  sessionTtlMs: number;
  login: { windowMs: number; max: number };
  ownerBootstrap?: { username: string; password: string };
  clientDir?: string;    // built SPA dir (dist/ui) to serve with history-fallback; absent => API-only
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LOGIN_WINDOW_MS = 15 * 60 * 1000;         // 15 minutes

const envSchema = z.object({
  DATA_DIR: z.string().optional(),
  SESSION_SECRET: z.string().min(1).optional(),
  USERS_PATH: z.string().optional(),
  PORT: z.coerce.number().optional(),
  COOKIE_SECURE: z.string().optional(),
  OWNER_USERNAME: z.string().optional(),
  OWNER_PASSWORD: z.string().optional(),
  CLIENT_DIR: z.string().optional(),
});

/**
 * Build a typed Config from an env-like object. `demoDir` is the bundled demo
 * dataset path (the entry point resolves it from import.meta.url; tests pass any
 * placeholder). Demo mode = no DATA_DIR: serve the demo dataset read-only with no
 * auth. Outside demo, SESSION_SECRET is mandatory.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  demoDir: string,
  defaultClientDir?: string,
): Config {
  const e = envSchema.parse(env);
  const demo = !e.DATA_DIR;
  if (!demo && !e.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required when DATA_DIR is set');
  }
  return {
    dataDir: e.DATA_DIR ?? demoDir,
    demo,
    sessionSecret: e.SESSION_SECRET ?? 'demo-ephemeral-secret',
    usersPath: e.USERS_PATH ?? './var/users.json',
    port: e.PORT ?? 8080,
    cookieSecure: e.COOKIE_SECURE?.toLowerCase() !== 'false',
    sessionTtlMs: SESSION_TTL_MS,
    login: { windowMs: LOGIN_WINDOW_MS, max: 10 },
    ownerBootstrap:
      e.OWNER_USERNAME && e.OWNER_PASSWORD
        ? { username: e.OWNER_USERNAME, password: e.OWNER_PASSWORD }
        : undefined,
    // Explicit CLIENT_DIR wins; otherwise serve the bundled build if one exists.
    clientDir: e.CLIENT_DIR ?? defaultClientDir,
  };
}
