import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit, type SimpleGit, GitError } from 'simple-git';

export interface CommitAuthor {
  name: string;
  email: string;
}

/** Generic identity for any commit not attributable to a logged-in app user
 *  (system/scheduler commits, or writes where the session user is unavailable). */
export const FALLBACK_AUTHOR: CommitAuthor = {
  name: "Ship's Log",
  email: 'shiplog@localhost',
};

/** Credentials for talking to a remote data repo. SSH deploy key XOR PAT; both
 *  optional (a `file://`/local remote, or an already-authenticated host, needs
 *  neither). */
export interface GitCredentials {
  /** Path to an SSH private key (deploy key). Composed into GIT_SSH_COMMAND. */
  sshKeyPath?: string;
  /** Fine-grained PAT for an https remote. Injected into the clone URL. */
  token?: string;
}

/**
 * Outcome of a `pull --rebase`. Exactly one `status`; `ok` is true only for the
 * two clean success cases; `conflict` is the single bit the sync scheduler keys
 * the visible "sync conflict" state on. `message` carries detail for `error`.
 *
 *  - `up-to-date`   — remote had nothing new; the working clone was already current.
 *  - `fast-forward` — remote was ahead with no local divergence; replayed cleanly.
 *  - `conflict`     — a rebase conflict; ABORTED, so the tree is back at the original
 *                     HEAD, clean and usable. Auto-push must stop until resolved.
 *  - `error`        — transport/credential/other failure BEFORE any rebase started;
 *                     the tree is untouched. Not a conflict; retry later.
 *  - `disabled`     — `dir` is not a git repo (local scratch / demo); no-op.
 */
export interface PullResult {
  status: 'up-to-date' | 'fast-forward' | 'conflict' | 'error' | 'disabled';
  ok: boolean;
  conflict: boolean;
  message?: string;
}

/**
 * Outcome of a `push` (with one automatic pull-rebase-and-retry on a non-fast-
 * forward rejection). `conflict` is true when the intervening pull hit a rebase
 * conflict, in which case the push was deliberately SKIPPED (never force-pushed).
 *
 *  - `pushed`     — the push (possibly after a clean rebase + retry) succeeded.
 *  - `up-to-date` — nothing local to push; remote already had our commits.
 *  - `conflict`   — a pull-rebase conflict blocked the push; push skipped, remote
 *                   untouched. Carries the `pull` result that surfaced it.
 *  - `error`      — transport/credential/other failure; remote untouched.
 *  - `disabled`   — `dir` is not a git repo; no-op.
 */
export interface PushResult {
  status: 'pushed' | 'up-to-date' | 'conflict' | 'error' | 'disabled';
  ok: boolean;
  conflict: boolean;
  message?: string;
  /** Present when a non-fast-forward push triggered an intervening pull-rebase. */
  pull?: PullResult;
}

/** Single-quote a value for safe inclusion in GIT_SSH_COMMAND when it needs it. */
function quoteIfNeeded(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * Build the env that points git at an SSH deploy key. `IdentitiesOnly=yes` stops
 * ssh from offering other agent keys; `StrictHostKeyChecking=accept-new` lets the
 * first connection trust-on-first-use without a pre-seeded known_hosts (and still
 * rejects a changed host key thereafter).
 */
export function buildSshEnv(sshKeyPath: string): { GIT_SSH_COMMAND: string } {
  const key = quoteIfNeeded(sshKeyPath);
  return {
    GIT_SSH_COMMAND: `ssh -i ${key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
  };
}

/** Inject a PAT into an https clone URL: https://x-access-token:<token>@host/... */
function withToken(url: string, token: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return url; // tokens only apply to https remotes
    u.username = 'x-access-token';
    u.password = token;
    return u.toString();
  } catch {
    return url; // not a parseable URL (e.g. scp-style ssh) → leave as-is
  }
}

/**
 * Thin wrapper over the local git working clone. The wrapper is the single git
 * client used by the write path: it commits ONLY the precise repo-relative paths
 * a write touched (never `git add .`), so an unrelated dirty file in the working
 * tree is never swept into a write's commit.
 *
 * If `dir` is not a git repo, the wrapper is DISABLED and `commitPaths` is a
 * no-op, so writes still persist files (persist-without-commit) for local scratch
 * dirs.
 *
 * pull/push/sync-conflict handling are layered on top of this in a later phase.
 */
export class GitRepo {
  private constructor(
    private readonly git: SimpleGit,
    private readonly dir: string,
    readonly enabled: boolean,
  ) {}

  static async open(dir: string, creds: GitCredentials = {}): Promise<GitRepo> {
    const git = makeGit(dir, creds);
    let enabled = false;
    try {
      enabled = await git.checkIsRepo();
    } catch (err) {
      // checkIsRepo() returns false for a non-repo dir; a throw here means an
      // infrastructure problem (git missing, permissions). Degrade to
      // persist-without-commit rather than crash — but log it, don't swallow it.
      console.warn(`GitRepo: could not determine repo status for ${dir}; commits disabled.`, err);
      enabled = false;
    }
    return new GitRepo(git, dir, enabled);
  }

  /**
   * Ensure a working clone exists at `dir` and return a GitRepo over it:
   *  - `dir` already a git repo  → open it in place (no fetch, no clobber).
   *  - `dir` empty/absent        → `git clone <url> <dir>` with credentials.
   * Credentials (SSH key env / PAT-in-URL) are applied to the clone and retained
   * for the opened repo so later remote ops authenticate the same way.
   */
  static async clone(url: string, dir: string, creds: GitCredentials = {}): Promise<GitRepo> {
    if (existsSync(join(dir, '.git'))) {
      return GitRepo.open(dir, creds);
    }
    await mkdir(dir, { recursive: true });
    const cloneUrl = creds.token ? withToken(url, creds.token) : url;
    const cloner = makeGit(dir, creds);
    await cloner.clone(cloneUrl, dir);
    return GitRepo.open(dir, creds);
  }

  /**
   * Stage exactly `paths` (repo-relative) — adds/edits via `git add`, deletions
   * via `git rm` for paths now missing on disk — then commit as `author`
   * (default `FALLBACK_AUTHOR`). Returns the new commit hash, or null when
   * disabled (the dir is not a git repo). Nothing outside `paths` is staged.
   */
  async commitPaths(
    paths: string[],
    message: string,
    author: CommitAuthor = FALLBACK_AUTHOR,
  ): Promise<string | null> {
    if (!this.enabled) return null;
    const present: string[] = [];
    const removed: string[] = [];
    for (const p of paths) {
      (existsSync(join(this.dir, p)) ? present : removed).push(p);
    }
    if (present.length) await this.git.add(present);
    // `--ignore-unmatch` keeps a delete idempotent if the path was never tracked.
    if (removed.length) await this.git.raw(['rm', '--ignore-unmatch', ...removed]);
    const res = await this.git.commit(message, { '--author': `${author.name} <${author.email}>` });
    return res.commit || null;
  }

  /**
   * True when this repo has at least one configured remote (an `origin` to sync
   * against). A git repo with NO remote (a local scratch clone) is `enabled` for
   * commits but has nothing to pull/push — the sync layer skips it rather than
   * reporting a spurious transport error.
   */
  async hasRemote(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const remotes = await this.git.getRemotes(false);
      return remotes.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Current `HEAD` commit sha, or null when disabled / unborn (no commits yet).
   * The sync layer compares HEAD before/after a pull to decide whether to reload
   * the in-memory dataset — more reliable than `PullResult.status`, because a
   * `pull --rebase` that REPLAYS a local commit advances HEAD while simple-git's
   * merge summary reports zero touched files.
   */
  async headSha(): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      return (await this.git.revparse(['HEAD'])).trim();
    } catch {
      return null; // unborn branch (no commits) → treat as "no HEAD"
    }
  }

  /**
   * `git pull --rebase` from the tracked remote, mapped onto a structured
   * {@link PullResult}. NEVER throws on the expected conflict path and NEVER
   * leaves a half-rebased tree: on a rebase conflict it runs `rebase --abort`,
   * restoring the original (clean) HEAD, and returns `{ conflict: true }`. A
   * transport/credential failure happens before any rebase begins, so the tree
   * is already untouched — it returns `{ status: 'error' }` with no abort.
   */
  async pullRebase(): Promise<PullResult> {
    if (!this.enabled) return { status: 'disabled', ok: false, conflict: false };
    try {
      const res = await this.git.pull(['--rebase']);
      // simple-git reports per-file `insertions`/`deletions` as objects; the
      // scalar totals live in `summary`. A bare "Already up to date" yields an
      // all-zero summary with no touched files.
      const touched =
        res.files.length > 0 ||
        res.created.length > 0 ||
        res.deleted.length > 0 ||
        res.summary.changes !== 0 ||
        res.summary.insertions !== 0 ||
        res.summary.deletions !== 0;
      return { status: touched ? 'fast-forward' : 'up-to-date', ok: true, conflict: false };
    } catch (err) {
      // A rebase that hit a conflict leaves a rebase-in-progress on disk; a
      // transport/credential failure does not. Use that to tell them apart, then
      // always restore a clean tree on the conflict path.
      if (await this.isRebaseInProgress()) {
        await this.abortRebaseQuietly();
        return { status: 'conflict', ok: false, conflict: true, message: messageOf(err) };
      }
      return { status: 'error', ok: false, conflict: false, message: messageOf(err) };
    }
  }

  /**
   * `git push` to the tracked remote, mapped onto a structured {@link PushResult}.
   * On a non-fast-forward rejection it runs {@link pullRebase} once and retries
   * the push a single time. If that pull surfaced a conflict, the push is SKIPPED
   * and the conflict is returned — it NEVER force-pushes and never clobbers the
   * remote.
   */
  async push(): Promise<PushResult> {
    if (!this.enabled) return { status: 'disabled', ok: false, conflict: false };
    try {
      await this.git.push();
      return { status: 'pushed', ok: true, conflict: false };
    } catch (err) {
      if (!isNonFastForward(err)) {
        return { status: 'error', ok: false, conflict: false, message: messageOf(err) };
      }
      // Remote moved under us: integrate via rebase, then retry the push once.
      const pull = await this.pullRebase();
      if (pull.conflict) {
        // Pull aborted to a clean tree; do NOT push — surface the conflict.
        return { status: 'conflict', ok: false, conflict: true, message: pull.message, pull };
      }
      if (!pull.ok) {
        return { status: 'error', ok: false, conflict: false, message: pull.message, pull };
      }
      try {
        await this.git.push();
        return { status: 'pushed', ok: true, conflict: false, pull };
      } catch (retryErr) {
        return { status: 'error', ok: false, conflict: false, message: messageOf(retryErr), pull };
      }
    }
  }

  /** True while a `rebase`/`rebase --merge` is paused on disk (conflict state). */
  private async isRebaseInProgress(): Promise<boolean> {
    return (
      existsSync(join(this.dir, '.git', 'rebase-merge')) ||
      existsSync(join(this.dir, '.git', 'rebase-apply'))
    );
  }

  /** Abort an in-progress rebase, swallowing any secondary failure (best-effort
   *  cleanup — the caller is already on the conflict path). */
  private async abortRebaseQuietly(): Promise<void> {
    try {
      await this.git.rebase(['--abort']);
    } catch (err) {
      console.warn(`GitRepo: rebase --abort failed in ${this.dir}; tree may need manual cleanup.`, err);
    }
  }
}

/** Best-effort message extraction from an unknown thrown value. */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Recognize git's non-fast-forward push rejection across its phrasings. */
function isNonFastForward(err: unknown): boolean {
  const text = err instanceof GitError ? `${err.message}` : messageOf(err);
  return /non-fast-forward|\[rejected\]|fetch first|tip of your current branch is behind|Updates were rejected/i.test(
    text,
  );
}

function makeGit(dir: string, creds: GitCredentials): SimpleGit {
  const sshCmd = creds.sshKeyPath ? buildSshEnv(creds.sshKeyPath).GIT_SSH_COMMAND : undefined;
  if (!sshCmd) return simpleGit(dir);
  // `allowUnsafeSshCommand` opts into the deliberate GIT_SSH_COMMAND we compose
  // for the deploy key; without it simple-git's guard refuses the env var.
  // We merge a single env override (keeping the inherited PATH/HOME/etc.) rather
  // than replacing the whole environment — passing all of process.env trips
  // simple-git's unsafe-var guard (GIT_EDITOR, …).
  return simpleGit({ baseDir: dir, unsafe: { allowUnsafeSshCommand: true } })
    .env('GIT_SSH_COMMAND', sshCmd);
}
