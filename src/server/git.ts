import { simpleGit, type SimpleGit } from 'simple-git';

export interface CommitAuthor {
  name: string;
  email: string;
}

/**
 * Thin wrapper over the local git working clone. P1c commits LOCALLY only —
 * pull/push/sync are P2. If `dir` is not a git repo, the wrapper is DISABLED and
 * `commitAll` is a no-op, so writes still persist files (persist-without-commit).
 */
export class GitRepo {
  private constructor(
    private readonly git: SimpleGit,
    readonly enabled: boolean,
  ) {}

  static async open(dir: string): Promise<GitRepo> {
    const git = simpleGit(dir);
    let enabled = false;
    try {
      enabled = await git.checkIsRepo();
    } catch {
      enabled = false;
    }
    return new GitRepo(git, enabled);
  }

  /** Stage everything under the working clone and commit as `author`. Returns the
   *  new commit hash, or null when disabled (the dir is not a git repo). */
  async commitAll(message: string, author: CommitAuthor): Promise<string | null> {
    if (!this.enabled) return null;
    await this.git.add('.');
    const res = await this.git.commit(message, { '--author': `${author.name} <${author.email}>` });
    return res.commit || null;
  }
}
