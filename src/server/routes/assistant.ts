/**
 * The assistant API (`/api/assistant/*`). A NO-OP when the feature is unconfigured:
 * with no `ctx.assistant`, nothing is registered, so the paths fall through to the
 * standard JSON 404.
 *
 * Identity is server-derived: the speaker system message + the per-user memory key
 * come from `req.viewer`, never the client. The transcript is the shared communal
 * thread (display); the agent keeps its own long-term memory.
 */
import type { Express, Request } from 'express';
import multer from 'multer';
import type { AppContext } from '../app.js';
import { requireAuth, requireOwner, denyInDemo } from '../middleware.js';
import { compressPhoto, PhotoError } from '../photos.js';
import type { ContentPart } from '../assistant.js';

/** Generic, boat/agent-agnostic speaker tag. The agent supplies its own persona. */
function speakerSystem(req: Request): string {
  const name = req.viewer.username ?? 'a crew member';
  return `You're speaking with ${name} (${req.viewer.role}) via the ship's web app.`;
}

function sse(res: import('express').Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerAssistantRoutes(app: Express, ctx: AppContext): void {
  const { assistant, config } = ctx;
  if (!assistant) return; // feature OFF — register nothing

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } });

  app.get('/api/assistant/history', requireAuth, (_req, res) => {
    res.json({ turns: assistant.log.list() });
  });

  app.post('/api/assistant/chat', requireAuth, denyInDemo(config), upload.single('photo'), async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message && !req.file) { res.status(400).json({ error: 'message required' }); return; }

    let content: string | ContentPart[] = message;
    let hasImage = false;
    if (req.file) {
      try {
        const { bytes } = await compressPhoto(req.file.buffer, req.file.mimetype);
        const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
        content = [
          { type: 'text', text: message || 'Please look at this photo.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ];
        hasImage = true;
      } catch (err) {
        if (err instanceof PhotoError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    }

    try {
      await assistant.log.append({
        role: 'user', name: req.viewer.username ?? undefined,
        content: message || '(photo)', at: ctx.now().toISOString(), image: hasImage || undefined,
      });
    } catch (err) {
      console.error('[assistant] failed to record user turn:', err);
      res.status(500).json({ error: 'internal error' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let full = '';
    try {
      const stream = assistant.client.chatStream({
        system: speakerSystem(req),
        messages: [{ role: 'user', content }],
        sessionId: assistant.sessionId,
        sessionKey: req.viewer.username ?? 'shared',
      });
      for await (const delta of stream) {
        full += delta;
        sse(res, 'delta', delta);
      }
      await assistant.log.append({ role: 'assistant', content: full, at: ctx.now().toISOString() });
      sse(res, 'done', { ok: true });
    } catch (err) {
      console.error('[assistant] chat stream failed:', err);
      // Generic, sanitized reason only (never the agent URL/secret).
      sse(res, 'error', { error: "couldn't reach the assistant" });
    } finally {
      res.end();
    }
  });

  app.delete('/api/assistant/history', requireAuth, requireOwner, denyInDemo(config), async (_req, res) => {
    await assistant.log.clear();
    res.status(204).end();
  });
}
