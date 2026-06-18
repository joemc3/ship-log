/**
 * The shared assistant transcript — the communal thread the SPA renders. Stored as
 * a capped JSON array in the users volume (dirname(USERS_PATH)), NEVER in the git
 * data repo. Writes are serialized through a promise chain so concurrent requests
 * can't corrupt the file. The agent keeps its own long-term memory; this is display.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AssistantTurn } from './assistant.js';

const DEFAULT_CAP = 200;

export class ChatLog {
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private turns: AssistantTurn[],
    private readonly cap: number,
  ) {}

  static async load(path: string, cap = DEFAULT_CAP): Promise<ChatLog> {
    let turns: AssistantTurn[] = [];
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
      if (Array.isArray(parsed)) turns = parsed as AssistantTurn[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return new ChatLog(path, turns, cap);
  }

  list(): AssistantTurn[] {
    return [...this.turns];
  }

  append(turn: AssistantTurn): Promise<void> {
    return this.enqueue(async () => {
      this.turns.push(turn);
      if (this.turns.length > this.cap) this.turns = this.turns.slice(-this.cap);
      await this.persist();
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      this.turns = [];
      await this.persist();
    });
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(fn, fn);
    return this.queue;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.turns, null, 2), 'utf8');
  }
}
