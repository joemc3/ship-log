import type { ShipStore } from './store.js';

/**
 * The periodic-pull mechanism, abstracted so tests can drive ticks deterministically
 * with no real waiting. The default ({@link realTimer}) is Node's global
 * `setInterval`/`clearInterval`; a test injects a fake whose registered callback it
 * fires by hand.
 */
export interface Timer {
  /** Schedule `cb` to run every `ms`; returns an opaque handle for {@link clear}.
   *  `cb` may be async — the production timer ignores its result; a test timer can
   *  await it to drive a tick deterministically. */
  set(cb: () => void | Promise<void>, ms: number): unknown;
  /** Cancel a previously-scheduled timer. */
  clear(handle: unknown): void;
}

/** The production timer: the Node global interval clock. Unref'd so a pending
 *  tick never keeps the process alive on its own. */
export const realTimer: Timer = {
  set(cb, ms) {
    const handle = setInterval(cb, ms);
    if (typeof (handle as { unref?: () => void }).unref === 'function') {
      (handle as { unref: () => void }).unref();
    }
    return handle;
  },
  clear(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

export interface SyncSchedulerOptions {
  /** Pull cadence in milliseconds (from `PULL_INTERVAL`). */
  intervalMs: number;
  /** Injectable timer; defaults to the global interval clock. */
  timer?: Timer;
}

/**
 * Drives `ShipStore.pull()` on a timer (and once on start), so a VPS app
 * continuously integrates Cowork's pushes. The pull is routed THROUGH the store,
 * which serializes it against the write queue, reloads the dataset on a
 * HEAD-advance, and folds the outcome into the observable sync-state.
 *
 * It is inert when the store is not syncable (no remote / scratch dir / demo):
 * `start()` becomes a no-op so demo and local-scratch boots never schedule a pull.
 * Overlapping ticks are coalesced — a tick that lands while a pull is still in
 * flight is skipped, never queued up behind it.
 */
export class SyncScheduler {
  private handle: unknown = null;
  private running = false;

  constructor(
    private readonly store: ShipStore,
    private readonly opts: SyncSchedulerOptions,
  ) {}

  /** Pull once now, then every `intervalMs`. No-op when sync is disabled. */
  async start(): Promise<void> {
    if (!this.store.syncEnabled()) return;
    const timer = this.opts.timer ?? realTimer;
    await this.tick(); // pull-on-load
    this.handle = timer.set(() => this.tick(), this.opts.intervalMs);
  }

  /** Stop the interval. Safe to call when never started. */
  stop(): void {
    if (this.handle !== null) {
      (this.opts.timer ?? realTimer).clear(this.handle);
      this.handle = null;
    }
  }

  /** One pull, coalesced so a slow pull never overlaps the next tick. Failures are
   *  already folded into sync-state by the store; we only guard against an
   *  unexpected throw so a single bad tick can't kill the interval. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.store.pull();
    } catch (err) {
      console.warn('SyncScheduler: pull tick failed unexpectedly.', err);
    } finally {
      this.running = false;
    }
  }
}
