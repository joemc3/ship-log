/**
 * Client for a self-hosted OpenAI-compatible agent (the "Purser"). Streams chat
 * completions and yields text deltas. The X-Hermes-Session-* headers scope the
 * agent's per-user memory on Hermes agents; non-Hermes agents ignore them.
 *
 * No persona/boat strings live here — the operator's agent owns its identity. We
 * only layer a generic speaker system message (built by the route from the session).
 */

export interface AssistantTurn {
  role: 'user' | 'assistant';
  name?: string;
  content: string;
  at: string;
  image?: boolean;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatParams {
  system: string;
  messages: ChatMessage[];
  sessionId: string;
  sessionKey: string;
}

export interface AssistantClient {
  chatStream(params: ChatParams): AsyncIterable<string>;
}

export interface AssistantSettings {
  url: string;
  apiKey?: string;
  model: string;
  label: string;
  sessionId: string;
  chatLogPath: string;
}

/** Parse one accumulated SSE buffer into [completeEvents, remainder]. */
function splitEvents(buf: string): [string[], string] {
  const parts = buf.split('\n\n');
  const remainder = parts.pop() ?? '';
  return [parts, remainder];
}

/** Extract the OpenAI delta content from a single `data: {...}` line, or null. */
function deltaFromEvent(evt: string): string | null {
  const line = evt.split('\n').find((l) => l.startsWith('data:'));
  if (!line) return null;
  const data = line.slice(5).trim();
  if (data === '[DONE]' || !data) return null;
  try {
    const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
    return json.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

export function createAssistantClient(s: AssistantSettings): AssistantClient {
  return {
    async *chatStream(params: ChatParams): AsyncIterable<string> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Hermes-Session-Id': params.sessionId,
        'X-Hermes-Session-Key': params.sessionKey,
      };
      if (s.apiKey) headers.Authorization = `Bearer ${s.apiKey}`;

      const res = await fetch(`${s.url}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: s.model,
          stream: true,
          messages: [{ role: 'system', content: params.system }, ...params.messages],
        }),
      });
      if (!res.ok || !res.body) throw new Error(`assistant request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const [events, remainder] = splitEvents(buf);
        buf = remainder;
        for (const evt of events) {
          const delta = deltaFromEvent(evt);
          if (delta) yield delta;
        }
      }
    },
  };
}
