import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { GitRepo, type GitCredentials } from './git.js';
import { ShipStore } from './store.js';

/** Outcome of preparing the working clone: the opened store plus a read-only flag
 *  and an optional warning (set when a configured clone could not be materialized,
 *  e.g. a missing/invalid credential — the app boots read-only instead of crashing). */
export interface PreparedStore {
  store: ShipStore;
  readOnly: boolean;
  warning?: string;
}

function credsOf(config: Config): GitCredentials {
  return { sshKeyPath: config.sshKeyPath, token: config.repoToken };
}

/**
 * Ensure a working clone exists for `config` and open a ShipStore over it.
 *
 *  - DATA_REPO_URL set + DATA_DIR empty/absent  → clone the remote, then open.
 *  - DATA_DIR already a clone                   → open it in place (no fetch).
 *  - No DATA_REPO_URL + non-repo DATA_DIR       → open in place; the store
 *    persists-without-commit (existing behavior; GitRepo warns).
 *  - Demo (no DATA_DIR, no DATA_REPO_URL)       → open the bundled demo dir;
 *    sync stays disabled.
 *
 * A clone/credential failure does NOT crash: the store still opens over whatever
 * is on disk (empty/partial) and the caller is told to boot READ-ONLY with the
 * returned warning surfaced as a banner.
 */
export async function prepareStore(
  config: Config,
  opts: { now?: () => Date; fallbackDir?: string } = {},
): Promise<PreparedStore> {
  const creds = credsOf(config);
  const storeOpts = opts.now ? { now: opts.now } : {};

  if (config.dataRepoUrl && !isClone(config.dataDir)) {
    try {
      const git = await GitRepo.clone(config.dataRepoUrl, config.dataDir, creds);
      const store = await ShipStore.open(config.dataDir, { ...storeOpts, git });
      return { store, readOnly: false };
    } catch (err) {
      const warning =
        `Could not clone data repo ${config.dataRepoUrl} (check DATA_SSH_KEY_PATH / ` +
        `DATA_REPO_TOKEN). Booting READ-ONLY. ${(err as Error).message}`;
      console.warn(warning);
      // Serve SOMETHING read-only instead of crashing: the partial clone if it
      // has a dataset, else the bundled demo dir as a stand-in.
      const dir = hasDataset(config.dataDir) ? config.dataDir : (opts.fallbackDir ?? config.dataDir);
      // Read-only stand-in (often the bundled demo dir): never sync.
      const store = await ShipStore.open(dir, { ...storeOpts, creds, sync: false });
      return { store, readOnly: true, warning };
    }
  }

  // Existing clone, non-repo scratch dir, or demo dir: open in place. Demo forces
  // sync off (the demo dir may sit inside this app repo's own remote).
  const store = await ShipStore.open(config.dataDir, { ...storeOpts, creds, sync: !config.demo });
  return { store, readOnly: false };
}

function isClone(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

/** A dir is a loadable dataset iff it has the required boat.yaml. */
function hasDataset(dir: string): boolean {
  return existsSync(join(dir, 'boat.yaml'));
}
