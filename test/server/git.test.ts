import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { GitRepo } from '../../src/server/git.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'shiplog-git-'));
}

async function initRepo(dir: string): Promise<void> {
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@shiplog.test');
  await git.addConfig('user.name', 'Test');
}

describe('GitRepo', () => {
  it('commits staged changes as the given author in a real repo', async () => {
    const dir = tmpDir();
    await initRepo(dir);
    writeFileSync(join(dir, 'a.md'), 'hello');
    const repo = await GitRepo.open(dir);
    expect(repo.enabled).toBe(true);
    const sha = await repo.commitAll('add a', { name: 'Cap', email: 'cap@boat.test' });
    expect(sha).toBeTruthy();
    const line = (await simpleGit(dir).raw(['log', '-1', '--format=%an|%s'])).trim();
    expect(line).toBe('Cap|add a');
  });

  it('stages new files AND deletions', async () => {
    const dir = tmpDir();
    await initRepo(dir);
    writeFileSync(join(dir, 'a.md'), 'one');
    const repo = await GitRepo.open(dir);
    await repo.commitAll('add a', { name: 'Cap', email: 'cap@boat.test' });
    rmSync(join(dir, 'a.md'));
    writeFileSync(join(dir, 'b.md'), 'two');
    const sha = await repo.commitAll('swap a for b', { name: 'Cap', email: 'cap@boat.test' });
    expect(sha).toBeTruthy();
    const files = (await simpleGit(dir).raw(['ls-files'])).trim();
    expect(files).toBe('b.md');
  });

  it('is disabled (no-op commit) when the dir is not a git repo', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'a.md'), 'hello');
    const repo = await GitRepo.open(dir);
    expect(repo.enabled).toBe(false);
    expect(await repo.commitAll('noop', { name: 'X', email: 'x@x' })).toBeNull();
  });
});
