import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { prepareStore } from './boot.js';
import { UsersStore } from './users.js';
import { createApp } from './app.js';
import { SyncScheduler } from './sync.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const demoDir = resolve(repoRoot, 'demo');
const distUi = resolve(repoRoot, 'dist/ui'); // built SPA, served with history-fallback

async function main(): Promise<void> {
  const config = loadConfig(process.env, demoDir, distUi);
  const { store, readOnly, warning } = await prepareStore(config, { fallbackDir: demoDir });
  if (warning) console.warn(warning);
  const users = await UsersStore.load(config.usersPath);

  if (config.ownerBootstrap && users.isEmpty()) {
    await users.bootstrapOwner(config.ownerBootstrap.username, config.ownerBootstrap.password);
    console.log(`Bootstrapped owner "${config.ownerBootstrap.username}".`);
  }
  if (!config.demo && users.isEmpty()) {
    console.warn('No owner configured: the gated area is locked until OWNER_USERNAME/OWNER_PASSWORD seed one.');
  }

  // Two-way sync scheduler: timed pull --rebase + pull-on-load, routed through the
  // store's write queue. Inert (start() is a no-op) unless the clone has a remote,
  // so demo + read-only + local-scratch boots never schedule a pull.
  const scheduler =
    !config.demo && !readOnly && store.syncEnabled()
      ? new SyncScheduler(store, { intervalMs: config.pullIntervalMs })
      : null;
  if (scheduler) {
    await scheduler.start();
    console.log(`Sync scheduler running (pull every ${Math.round(config.pullIntervalMs / 1000)}s).`);
  }

  const server = createApp({ config, store, users }).listen(config.port, () => {
    const mode = config.demo ? ' (DEMO MODE)' : readOnly ? ' (READ-ONLY — sync unavailable)' : '';
    console.log(`Ship's Log server listening on :${config.port}${mode}`);
  });
  server.on('error', (err) => { console.error(err); process.exit(1); });

  const shutdown = (signal: string): void => {
    console.log(`Received ${signal}, shutting down.`);
    scheduler?.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => { console.error(err); process.exit(1); });
