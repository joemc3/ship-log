import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAssistantClient, type AssistantSettings } from '../../src/server/assistant.js';

const SETTINGS: AssistantSettings = {
  url: 'http://agent:8642', apiKey: 'k', model: 'm', label: 'Ask the Purser',
  sessionId: 'shiplog', chatLogPath: '/tmp/x.json',
};

/** A web ReadableStream that emits the given string chunks (as the SSE body would). */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('createAssistantClient', () => {
  it('POSTs the right request and yields content deltas in order', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        streamOf([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createAssistantClient(SETTINGS);
    const out: string[] = [];
    for await (const d of client.chatStream({
      system: 'You are speaking with joe (owner) via the ship\'s web app.',
      messages: [{ role: 'user', content: 'hi' }],
      sessionId: 'shiplog', sessionKey: 'joe',
    })) out.push(d);

    expect(out.join('')).toBe('Hello');
    expect(calls[0]!.url).toBe('http://agent:8642/v1/chat/completions');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    expect(headers['X-Hermes-Session-Id']).toBe('shiplog');
    expect(headers['X-Hermes-Session-Key']).toBe('joe');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('m');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are speaking with joe (owner) via the ship\'s web app.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })));
    const client = createAssistantClient(SETTINGS);
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of client.chatStream({ system: 's', messages: [], sessionId: 'shiplog', sessionKey: 'joe' })) { /* drain */ }
    }).rejects.toThrow();
  });

  it('omits Authorization when no apiKey is set', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(streamOf(['data: [DONE]\n\n']), { status: 200 });
    }));
    const client = createAssistantClient({ ...SETTINGS, apiKey: undefined });
    for await (const _ of client.chatStream({ system: 's', messages: [], sessionId: 'shiplog', sessionKey: 'joe' })) { /* drain */ }
    expect((calls[0]!.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
