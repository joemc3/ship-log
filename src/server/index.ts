import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { ShipStore } from './store.js';
import { UsersStore } from './users.js';
import { createApp } from './app.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const demoDir = resolve(repoRoot, 'demo');
const distUi = resolve(repoRoot, 'dist/ui'); // built SPA, served with history-fallback

async function main(): Promise<void> {
  const config = loadConfig(process.env, demoDir, distUi);
  const store = await ShipStore.open(config.dataDir);
  const users = await UsersStore.load(config.usersPath);

  if (config.ownerBootstrap && users.isEmpty()) {
    await users.bootstrapOwner(config.ownerBootstrap.username, config.ownerBootstrap.password);
    console.log(`Bootstrapped owner "${config.ownerBootstrap.username}".`);
  }
  if (!config.demo && users.isEmpty()) {
    console.warn('No owner configured: the gated area is locked until OWNER_USERNAME/OWNER_PASSWORD seed one.');
  }

  const server = createApp({ config, store, users }).listen(config.port, () => {
    console.log(`Ship's Log server listening on :${config.port}${config.demo ? ' (DEMO MODE)' : ''}`);
  });
  server.on('error', (err) => { console.error(err); process.exit(1); });
}

main().catch((err) => { console.error(err); process.exit(1); });
