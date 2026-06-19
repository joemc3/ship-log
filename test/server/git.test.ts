import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { GitRepo, buildSshEnv, FALLBACK_AUTHOR } from '../../src/server/git.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'shiplog-git-'));
}

async function initRepo(dir: string): Promise<void> {
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@shiplog.test');
  await git.addConfig('user.name', 'Test');
}

/** Seed a bare repo with one commit on its default branch; return its path. */
async function makeSeededBare(): Promise<{ bare: string; defaultBranch: string }> {
  const bare = tmpDir();
  await simpleGit(bare).init(['--bare']);
  // Populate via a throwaway working clone.
  const work = tmpDir();
  const wg = simpleGit(work);
  await wg.clone(bare, work);
  await wg.addConfig('user.email', 'seed@shiplog.test');
  await wg.addConfig('user.name', 'Seed');
  writeFileSync(join(work, 'boat.yaml'), 'name: Seeded\n');
  await wg.add('.');
  await wg.commit('seed');
  const branch = (await wg.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  await wg.push('origin', branch);
  return { bare, defaultBranch: branch };
}

/** Clone a bare repo into a fresh working dir, with a committer identity set. */
async function workClone(bare: string): Promise<{ dir: string; git: ReturnType<typeof simpleGit> }> {
  const dir = join(tmpDir(), 'work');
  const git = simpleGit();
  await git.clone(`file://${bare}`, dir);
  const g = simpleGit(dir);
  await g.addConfig('user.email', 'cap@boat.test');
  await g.addConfig('user.name', 'Cap');
  return { dir, git: g };
}

/** Head subject of a working dir's current branch. */
async function headSubject(dir: string): Promise<string> {
  return (await simpleGit(dir).raw(['log', '-1', '--format=%s'])).trim();
}

/** Head sha of a working dir's current branch. */
async function headSha(dir: string): Promise<string> {
  return (await simpleGit(dir).revparse(['HEAD'])).trim();
}

/** True iff the working tree + index are clean (no in-progress rebase residue). */
async function isClean(dir: string): Promise<boolean> {
  const status = await simpleGit(dir).status();
  return status.isClean();
}

describe('GitRepo.commitPaths', () => {
  it('commits the named path as the given author in a real repo', async () => {
    const dir = tmpDir();
    await initRepo(dir);
    writeFileSync(join(dir, 'a.md'), 'hello');
    const repo = await GitRepo.open(dir);
    expect(repo.enabled).toBe(true);
    const sha = await repo.commitPaths(['a.md'], 'add a', { name: 'Cap', email: 'cap@boat.test' });
    expect(sha).toBeTruthy();
    const line = (await simpleGit(dir).raw(['log', '-1', '--format=%an|%s'])).trim();
    expect(line).toBe('Cap|add a');
  });

  it('GOLDEN: an unrelated dirty file is NOT included in a write commit', async () => {
    const dir = tmpDir();
    await initRepo(dir);
    writeFileSync(join(dir, 'a.md'), 'one');
    const repo = await GitRepo.open(dir);
    await repo.commitPaths(['a.md'], 'add a', { name: 'Cap', email: 'cap@boat.test' });
    // Now a write touches b.md while an UNRELATED file c.md is also dirty.
    writeFileSync(join(dir, 'b.md'), 'two');
    writeFileSync(join(dir, 'c.md'), 'dirty unrelated');
    const sha = await repo.commitPaths(['b.md'], 'add b only', { name: 'Cap', email: 'cap@boat.test' });
    expect(sha).toBeTruthy();
    // The commit contains ONLY b.md.
    const changed = (await simpleGit(dir).raw(['show', '--name-only', '--format=', 'HEAD'])).trim();
    expect(changed).toBe('b.md');
    // c.md is still untracked / never committed.
    const tracked = (await simpleGit(dir).raw(['ls-files'])).trim().split('\n').sort();
    expect(tracked).toEqual(['a.md', 'b.md']);
  });

  it('stages a deletion when a named path no longer exists on disk', async () => {
    const dir = tmpDir();
    await initRepo(dir);
    writeFileSync(join(dir, 'a.md'), 'one');
    const repo = await GitRepo.open(dir);
    await repo.commitPaths(['a.md'], 'add a', { name: 'Cap', email: 'cap@boat.test' });
    rmSync(join(dir, 'a.md'));
    const sha = await repo.commitPaths(['a.md'], 'remove a', { name: 'Cap', email: 'cap@boat.test' });
    expect(sha).toBeTruthy();
    const files = (await simpleGit(dir).raw(['ls-files'])).trim();
    expect(files).toBe('');
  });

  it('stages adds and deletions together across multiple named paths', async () => {
    const dir = tmpDir();
    await initRepo(dir);
    writeFileSync(join(dir, 'a.md'), 'one');
    const repo = await GitRepo.open(dir);
    await repo.commitPaths(['a.md'], 'add a', { name: 'Cap', email: 'cap@boat.test' });
    rmSync(join(dir, 'a.md'));
    writeFileSync(join(dir, 'b.md'), 'two');
    const sha = await repo.commitPaths(['a.md', 'b.md'], 'swap a for b', { name: 'Cap', email: 'cap@boat.test' });
    expect(sha).toBeTruthy();
    const files = (await simpleGit(dir).raw(['ls-files'])).trim();
    expect(files).toBe('b.md');
  });

  it('uses the fallback identity when no author is supplied', async () => {
    const dir = tmpDir();
    await initRepo(dir);
    writeFileSync(join(dir, 'a.md'), 'hello');
    const repo = await GitRepo.open(dir);
    await repo.commitPaths(['a.md'], 'system commit');
    const line = (await simpleGit(dir).raw(['log', '-1', '--format=%an|%ae'])).trim();
    expect(line).toBe(`${FALLBACK_AUTHOR.name}|${FALLBACK_AUTHOR.email}`);
  });

  it('is disabled (no-op commit) when the dir is not a git repo', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'a.md'), 'hello');
    const repo = await GitRepo.open(dir);
    expect(repo.enabled).toBe(false);
    expect(await repo.commitPaths(['a.md'], 'noop', { name: 'X', email: 'x@x' })).toBeNull();
  });
});

describe('GitRepo.commitPaths — committer identity (no ambient git identity)', () => {
  // Simulate a fresh deploy clone (e.g. the slim Docker image's `node` user):
  // no system/global git identity AND GECOS auto-detection disabled. In that
  // environment `git commit` aborts AFTER `git add` has staged the file — the
  // production bug where a trip write left the record staged-but-uncommitted,
  // so it never pushed and was invisible to the data repo. GitRepo must give the
  // clone a committer identity itself rather than rely on the host's git config.
  let prevGlobal: string | undefined;
  let prevSystem: string | undefined;

  beforeEach(() => {
    const cfg = join(tmpDir(), 'gitconfig');
    writeFileSync(cfg, '[user]\n\tuseConfigOnly = true\n');
    prevGlobal = process.env.GIT_CONFIG_GLOBAL;
    prevSystem = process.env.GIT_CONFIG_SYSTEM;
    process.env.GIT_CONFIG_GLOBAL = cfg;
    process.env.GIT_CONFIG_SYSTEM = '/dev/null';
  });

  afterEach(() => {
    if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
    if (prevSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
    else process.env.GIT_CONFIG_SYSTEM = prevSystem;
  });

  it('commits a write even when the clone has no externally-configured identity', async () => {
    const dir = tmpDir();
    // Deliberately do NOT set user.name/user.email (unlike initRepo) — the clone
    // arrives with no identity, exactly as a fresh deploy clone does.
    await simpleGit(dir).init();
    writeFileSync(join(dir, 'a.md'), 'hello');
    const repo = await GitRepo.open(dir);
    expect(repo.enabled).toBe(true);
    const sha = await repo.commitPaths(['a.md'], 'add a', { name: 'Cap', email: 'cap@boat.test' });
    expect(sha).toBeTruthy();
    // The logged-in user is the AUTHOR; the clone's committer is the app fallback.
    const line = (await simpleGit(dir).raw(['log', '-1', '--format=%an <%ae>|%cn <%ce>'])).trim();
    expect(line).toBe(`Cap <cap@boat.test>|${FALLBACK_AUTHOR.name} <${FALLBACK_AUTHOR.email}>`);
  });
});

describe('GitRepo.clone (clone-or-open)', () => {
  it('clones a seeded bare repo into a fresh data dir over file://', async () => {
    const { bare } = await makeSeededBare();
    const dataDir = join(tmpDir(), 'clone');
    const repo = await GitRepo.clone(`file://${bare}`, dataDir, {});
    expect(repo.enabled).toBe(true);
    expect(existsSync(join(dataDir, 'boat.yaml'))).toBe(true);
    // The working clone is a real repo with the seeded commit.
    const line = (await simpleGit(dataDir).raw(['log', '-1', '--format=%s'])).trim();
    expect(line).toBe('seed');
  });

  it('opens an existing clone in place rather than re-cloning', async () => {
    const { bare } = await makeSeededBare();
    const dataDir = join(tmpDir(), 'clone');
    await GitRepo.clone(`file://${bare}`, dataDir, {});
    // Local-only change in the working clone.
    writeFileSync(join(dataDir, 'local.txt'), 'local');
    const repo2 = await GitRepo.clone(`file://${bare}`, dataDir, {});
    expect(repo2.enabled).toBe(true);
    // Opening did not wipe the working clone.
    expect(existsSync(join(dataDir, 'local.txt'))).toBe(true);
  });

  it('applies an SSH-key credential without breaking a local clone', async () => {
    // The composed GIT_SSH_COMMAND is harmless for a file:// remote (git does not
    // shell out to ssh), so this proves the credential plumbing does not regress
    // the local path. The real GitHub key is exercised only in deployment.
    const { bare } = await makeSeededBare();
    const dataDir = join(tmpDir(), 'clone');
    const repo = await GitRepo.clone(`file://${bare}`, dataDir, { sshKeyPath: '/secrets/deploy_key' });
    expect(repo.enabled).toBe(true);
    expect(existsSync(join(dataDir, 'boat.yaml'))).toBe(true);
  });
});

describe('GitRepo.pullRebase', () => {
  it('reports up-to-date when nothing changed on the remote', async () => {
    const { bare } = await makeSeededBare();
    const { dir } = await workClone(bare);
    const repo = await GitRepo.open(dir);
    const res = await repo.pullRebase();
    expect(res.conflict).toBe(false);
    expect(res.status).toBe('up-to-date');
    expect(res.ok).toBe(true);
  });

  it('fast-forwards cleanly when the remote is ahead and there is no divergence', async () => {
    const { bare } = await makeSeededBare();
    // Clone A pushes a NEW file the remote then carries.
    const a = await workClone(bare);
    writeFileSync(join(a.dir, 'boat.yaml'), 'name: Updated by A\n');
    await a.git.add('.');
    await a.git.commit('A updates boat');
    await a.git.push();
    // Clone B has no local divergence → its pull --rebase fast-forwards.
    const b = await workClone(bare);
    // (B was cloned AFTER A pushed in this ordering — instead clone B first to test FF.)
    const repo = await GitRepo.open(b.dir);
    const res = await repo.pullRebase();
    expect(res.conflict).toBe(false);
    expect(res.ok).toBe(true);
    // B now carries A's content.
    expect(existsSync(join(b.dir, 'boat.yaml'))).toBe(true);
  });

  it('fast-forwards a behind clone to pick up a remote commit (conflict:false)', async () => {
    const { bare } = await makeSeededBare();
    // Clone B FIRST so it is strictly behind once A pushes.
    const b = await workClone(bare);
    const repo = await GitRepo.open(b.dir);
    // Clone A pushes a change to the shared file.
    const a = await workClone(bare);
    writeFileSync(join(a.dir, 'boat.yaml'), 'name: Updated by A\n');
    await a.git.add('.');
    await a.git.commit('A updates boat');
    await a.git.push();
    // B has NO local divergence → fast-forward.
    const res = await repo.pullRebase();
    expect(res.conflict).toBe(false);
    expect(res.ok).toBe(true);
    expect(res.status).toBe('fast-forward');
    expect(await headSubject(b.dir)).toBe('A updates boat');
  });

  it('CONFLICT: returns conflict:true, aborts the rebase, leaves a clean tree at the original HEAD', async () => {
    const { bare } = await makeSeededBare();
    // B clones first and records its starting HEAD.
    const b = await workClone(bare);
    const repo = await GitRepo.open(b.dir);
    const startSha = await headSha(b.dir);
    // A pushes a change to the SAME file (boat.yaml).
    const a = await workClone(bare);
    writeFileSync(join(a.dir, 'boat.yaml'), 'name: Edited by A\n');
    await a.git.add('.');
    await a.git.commit('A edits boat');
    await a.git.push();
    // B locally edits the SAME file differently and commits.
    writeFileSync(join(b.dir, 'boat.yaml'), 'name: Edited by B\n');
    await b.git.add('.');
    await b.git.commit('B edits boat');
    const bDivergedSha = await headSha(b.dir);
    expect(bDivergedSha).not.toBe(startSha);

    const res = await repo.pullRebase();
    expect(res.conflict).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.status).toBe('conflict');
    // The rebase was aborted: tree is clean (no conflict markers / no MERGE state),
    // and HEAD is exactly where B's own commit left it — unchanged by the failed pull.
    expect(await isClean(b.dir)).toBe(true);
    expect(await headSha(b.dir)).toBe(bDivergedSha);
    // B's own content survives intact.
    expect(existsSync(join(b.dir, '.git', 'rebase-merge'))).toBe(false);
    expect(existsSync(join(b.dir, '.git', 'rebase-apply'))).toBe(false);
  });

  it('surfaces a transport/credential error (not a conflict) for a bogus remote', async () => {
    const { bare } = await makeSeededBare();
    const { dir } = await workClone(bare);
    // Repoint origin at a path that does not exist → pull fails at transport.
    await simpleGit(dir).remote(['set-url', 'origin', `file://${tmpDir()}/does-not-exist`]);
    const repo = await GitRepo.open(dir);
    const res = await repo.pullRebase();
    expect(res.conflict).toBe(false);
    expect(res.ok).toBe(false);
    expect(res.status).toBe('error');
    expect(res.message).toBeTruthy();
    // Tree is still clean and usable.
    expect(await isClean(dir)).toBe(true);
  });
});

describe('GitRepo.push', () => {
  it('pushes a local commit to the bare remote (clean ok)', async () => {
    const { bare } = await makeSeededBare();
    const { dir, git } = await workClone(bare);
    writeFileSync(join(dir, 'log.md'), 'entry\n');
    await git.add('.');
    await git.commit('add log');
    const repo = await GitRepo.open(dir);
    const res = await repo.push();
    expect(res.conflict).toBe(false);
    expect(res.ok).toBe(true);
    // A fresh clone of the bare sees the pushed commit.
    const verify = await workClone(bare);
    expect(existsSync(join(verify.dir, 'log.md'))).toBe(true);
  });

  it('UNRELATED divergence: rejected push pulls-then-retries and succeeds; bare holds both commits', async () => {
    const { bare } = await makeSeededBare();
    // B clones, then A pushes an UNRELATED file → B is now behind.
    const b = await workClone(bare);
    const a = await workClone(bare);
    writeFileSync(join(a.dir, 'a-file.md'), 'from A\n');
    await a.git.add('.');
    await a.git.commit('A adds a-file');
    await a.git.push();
    // B commits its own UNRELATED file and pushes → first push is non-FF rejected,
    // pull --rebase replays B atop A (no conflict), retry push succeeds.
    writeFileSync(join(b.dir, 'b-file.md'), 'from B\n');
    await b.git.add('.');
    await b.git.commit('B adds b-file');
    const repo = await GitRepo.open(b.dir);
    const res = await repo.push();
    expect(res.conflict).toBe(false);
    expect(res.ok).toBe(true);
    // The bare repo now holds BOTH commits — verify via a fresh clone.
    const verify = await workClone(bare);
    expect(existsSync(join(verify.dir, 'a-file.md'))).toBe(true);
    expect(existsSync(join(verify.dir, 'b-file.md'))).toBe(true);
  });

  it('CONFLICTING divergence: push is skipped, conflict surfaced, no force-push, tree clean at B HEAD', async () => {
    const { bare } = await makeSeededBare();
    const b = await workClone(bare);
    const a = await workClone(bare);
    // A edits the shared file and pushes.
    writeFileSync(join(a.dir, 'boat.yaml'), 'name: A wins\n');
    await a.git.add('.');
    await a.git.commit('A edits boat');
    await a.git.push();
    const aSha = await headSha(a.dir);
    // B edits the SAME file differently and tries to push.
    writeFileSync(join(b.dir, 'boat.yaml'), 'name: B wins\n');
    await b.git.add('.');
    await b.git.commit('B edits boat');
    const bSha = await headSha(b.dir);
    const repo = await GitRepo.open(b.dir);
    const res = await repo.push();
    expect(res.conflict).toBe(true);
    expect(res.ok).toBe(false);
    // B's tree is clean at its own HEAD — the failed sync left nothing behind.
    expect(await isClean(b.dir)).toBe(true);
    expect(await headSha(b.dir)).toBe(bSha);
    // The remote was NOT clobbered: bare HEAD is still A's commit.
    const remoteSha = (await simpleGit(bare).raw(['rev-parse', 'HEAD'])).trim();
    expect(remoteSha).toBe(aSha);
  });
});

describe('GitRepo remote ops are disabled when not a repo', () => {
  it('pullRebase / push are no-ops returning disabled status', async () => {
    const dir = tmpDir();
    const repo = await GitRepo.open(dir);
    expect(repo.enabled).toBe(false);
    const pr = await repo.pullRebase();
    expect(pr.ok).toBe(false);
    expect(pr.conflict).toBe(false);
    expect(pr.status).toBe('disabled');
    const pu = await repo.push();
    expect(pu.ok).toBe(false);
    expect(pu.conflict).toBe(false);
    expect(pu.status).toBe('disabled');
  });
});

describe('buildSshEnv', () => {
  it('composes GIT_SSH_COMMAND with the key path and safe defaults', () => {
    const env = buildSshEnv('/secrets/deploy_key');
    expect(env.GIT_SSH_COMMAND).toContain('ssh -i /secrets/deploy_key');
    expect(env.GIT_SSH_COMMAND).toContain('-o IdentitiesOnly=yes');
    expect(env.GIT_SSH_COMMAND).toContain('-o StrictHostKeyChecking=accept-new');
  });

  it('quotes a key path that contains spaces', () => {
    const env = buildSshEnv('/secrets/my key');
    expect(env.GIT_SSH_COMMAND).toContain('-i "/secrets/my key"');
  });
});
