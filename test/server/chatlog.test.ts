import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatLog } from '../../src/server/chatlog.js';
import type { AssistantTurn } from '../../src/server/assistant.js';

const turn = (content: string, role: AssistantTurn['role'] = 'user'): AssistantTurn =>
  ({ role, content, at: '2024-07-01T00:00:00.000Z' });

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'shiplog-chatlog-')), 'log.json');
}

describe('ChatLog', () => {
  it('starts empty when the file is missing', async () => {
    const log = await ChatLog.load(tmpPath());
    expect(log.list()).toEqual([]);
  });

  it('appends and survives a reload', async () => {
    const path = tmpPath();
    const a = await ChatLog.load(path);
    await a.append(turn('hello'));
    await a.append(turn('hi there', 'assistant'));
    const b = await ChatLog.load(path);
    expect(b.list().map((t) => t.content)).toEqual(['hello', 'hi there']);
  });

  it('caps the retained turns, dropping the oldest', async () => {
    const path = tmpPath();
    const log = await ChatLog.load(path, 3);
    for (const n of ['1', '2', '3', '4']) await log.append(turn(n));
    expect(log.list().map((t) => t.content)).toEqual(['2', '3', '4']);
  });

  it('clear() empties the log and persists', async () => {
    const path = tmpPath();
    const a = await ChatLog.load(path);
    await a.append(turn('x'));
    await a.clear();
    expect(a.list()).toEqual([]);
    expect((await ChatLog.load(path)).list()).toEqual([]);
  });
});
