import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
import { z } from 'zod';

export interface Config {
  dataDir: string;       // resolved working-clone directory (the demo dir when in demo mode)
  demo: boolean;         // true when neither DATA_DIR nor DATA_REPO_URL was configured
  sessionSecret: string;
  usersPath: string;
  port: number;
  cookieSecure: boolean;
  sessionTtlMs: number;
  login: { windowMs: number; max: number };
  ownerBootstrap?: { username: string; password: string };
  clientDir?: string;    // built SPA dir (dist/ui) to serve with history-fallback; absent => API-only
  dataRepoUrl?: string;  // remote data repo to clone on boot (ssh or https); absent => use DATA_DIR in place
  sshKeyPath?: string;   // SSH deploy-key path → GIT_SSH_COMMAND (DATA_SSH_KEY_PATH)
  repoToken?: string;    // fine-grained PAT for an https remote (DATA_REPO_TOKEN)
  pullIntervalMs: number;// sync scheduler cadence (PULL_INTERVAL seconds); default 5 min
  assistant?: {
    url: string;
    apiKey?: string;
    model: string;
    label: string;
    sessionId: string;
    chatLogPath: string;
  };
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LOGIN_WINDOW_MS = 15 * 60 * 1000;         // 15 minutes
const DEFAULT_PULL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const envSchema = z.object({
  DATA_DIR: z.string().optional(),
  SESSION_SECRET: z.string().min(1).optional(),
  USERS_PATH: z.string().optional(),
  PORT: z.coerce.number().optional(),
  COOKIE_SECURE: z.string().optional(),
  OWNER_USERNAME: z.string().optional(),
  OWNER_PASSWORD: z.string().optional(),
  CLIENT_DIR: z.string().optional(),
  DATA_REPO_URL: z.string().optional(),
  DATA_SSH_KEY_PATH: z.string().optional(),
  DATA_REPO_TOKEN: z.string().optional(),
  PULL_INTERVAL: z.coerce.number().positive().optional(), // seconds between sync pulls
  ASSISTANT_URL: z.string().optional(),
  ASSISTANT_API_KEY: z.string().optional(),
  ASSISTANT_MODEL: z.string().optional(),
  ASSISTANT_LABEL: z.string().optional(),
  ASSISTANT_SESSION_ID: z.string().optional(),
});

/** Default working-clone path used when DATA_REPO_URL is set but DATA_DIR is not. */
export const DEFAULT_CLONE_DIR = './var/data';

/** Secret-bearing vars that also accept a `<NAME>_FILE` Docker-secret indirection
 *  (the file's contents become the value). The inline var always wins when both
 *  are present. The trailing newline a secret file usually carries is trimmed. */
const SECRET_FILE_VARS = ['SESSION_SECRET', 'OWNER_PASSWORD', 'DATA_REPO_TOKEN', 'ASSISTANT_API_KEY'] as const;

/**
 * Resolve `<NAME>_FILE` Docker-secret indirection into `<NAME>` on a shallow copy
 * of the env. Docker/compose mounts each secret at `/run/secrets/<name>` and the
 * VPS override points `SESSION_SECRET_FILE`/`OWNER_PASSWORD_FILE`/… at those paths;
 * this reads the file so the rest of config sees a plain value. A missing file is a
 * loud boot error (a misconfigured secret must never silently fall through to demo
 * mode or an empty secret).
 */
function resolveSecretFiles(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const name of SECRET_FILE_VARS) {
    const fileVar = `${name}_FILE`;
    const path = env[fileVar];
    if (!path || out[name]) continue; // no _FILE, or inline var already wins
    try {
      out[name] = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
    } catch (err) {
      throw new Error(`${fileVar} points at an unreadable secret file (${path}): ${(err as Error).message}`);
    }
  }
  return out;
}

/**
 * True when `child` resolves to `parent` itself or any path inside it. Used to
 * keep the users store OUT of the data working clone: if `USERS_PATH` lands inside
 * `DATA_DIR`, the hashed-credential file would be swept into the git data repo (and
 * committed/pushed). Compares resolved absolute paths so `..` segments and
 * shared-prefix siblings (`/srv/data` vs `/srv/data-backup`) are judged correctly.
 */
function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  // Inside iff the relative path does not climb out (`..`) and is not absolute
  // (different root). The empty string means child === parent (also "inside").
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Build a typed Config from an env-like object. `demoDir` is the bundled demo
 * dataset path (the entry point resolves it from import.meta.url; tests pass any
 * placeholder). Demo mode = NEITHER DATA_DIR nor DATA_REPO_URL: serve the demo
 * dataset read-only with no auth and sync disabled. Any configured deployment
 * (DATA_DIR and/or DATA_REPO_URL) is non-demo and requires SESSION_SECRET.
 *
 * Working-clone path: explicit DATA_DIR wins; with only DATA_REPO_URL set, the
 * clone materializes at DEFAULT_CLONE_DIR.
 *
 * Secrets: SESSION_SECRET / OWNER_PASSWORD / DATA_REPO_TOKEN each also accept a
 * `<NAME>_FILE` Docker-secret indirection (the file's contents are the value); the
 * inline var wins when both are set. See {@link resolveSecretFiles}.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  demoDir: string,
  defaultClientDir?: string,
): Config {
  const e = envSchema.parse(resolveSecretFiles(env));
  const demo = !e.DATA_DIR && !e.DATA_REPO_URL;
  if (!demo && !e.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required when DATA_DIR or DATA_REPO_URL is set');
  }
  const dataDir = demo ? demoDir : (e.DATA_DIR ?? DEFAULT_CLONE_DIR);
  const usersPath = e.USERS_PATH ?? './var/users.json';
  // Users-store-volume invariant: the hashed-credential store must NEVER live inside
  // the data working clone, or it would be committed/pushed into the git data repo.
  // Fail loud at boot. Skipped in demo mode (the "dataDir" is just the bundled demo
  // dataset we never write to).
  if (!demo && isInside(dataDir, usersPath)) {
    throw new Error(
      `USERS_PATH (${usersPath}) must not resolve inside DATA_DIR (${dataDir}): the users ` +
        `store must stay out of the data git repo. Point USERS_PATH at a separate volume.`,
    );
  }
  const assistant = !demo && e.ASSISTANT_URL
    ? {
        url: e.ASSISTANT_URL,
        apiKey: e.ASSISTANT_API_KEY,
        model: e.ASSISTANT_MODEL ?? 'default',
        label: e.ASSISTANT_LABEL ?? 'Ask the Purser',
        sessionId: e.ASSISTANT_SESSION_ID ?? 'shiplog',
        chatLogPath: join(dirname(usersPath), 'assistant-chatlog.json'),
      }
    : undefined;
  return {
    dataDir,
    demo,
    sessionSecret: e.SESSION_SECRET ?? 'demo-ephemeral-secret',
    usersPath,
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
    // Sync (P2): cloned on boot when DATA_DIR is empty/absent; demo leaves these unset.
    dataRepoUrl: demo ? undefined : e.DATA_REPO_URL,
    sshKeyPath: e.DATA_SSH_KEY_PATH,
    repoToken: e.DATA_REPO_TOKEN,
    // PULL_INTERVAL is in SECONDS for operator friendliness; stored as ms.
    pullIntervalMs: e.PULL_INTERVAL ? e.PULL_INTERVAL * 1000 : DEFAULT_PULL_INTERVAL_MS,
    assistant,
  };
}
