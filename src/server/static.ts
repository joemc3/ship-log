import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, sep, extname, normalize } from 'node:path';
import type { Express, Request, Response, NextFunction } from 'express';
import type { AppContext } from './app.js';
import { requireAuth } from './middleware.js';

/**
 * Two static surfaces the API needs, both registered to NEVER shadow /api:
 *
 *  1. Repo photos — stream binaries from <dataDir>/photos/ (the demo dir in demo
 *     mode). Path-traversal-safe (the resolved target must stay strictly inside
 *     the photos dir), content-typed, and under the same auth posture as reads:
 *     open in demo, requireAuth otherwise.
 *  2. The built SPA (dist/ui) with history-fallback to index.html for any
 *     non-/api, non-/photos route, so client-side routes deep-link cleanly.
 *
 * Order matters: these run AFTER the API routes and AFTER an /api-scoped JSON
 * 404, so an unknown /api/* path is still a JSON 404 — the SPA never serves
 * index.html for an API request.
 */

const PHOTO_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const SPA_ASSET_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** True iff `target` resolves strictly inside `root` (no `..` escape). */
function isInside(root: string, target: string): boolean {
  const rootResolved = resolve(root);
  const t = resolve(target);
  return t === rootResolved || t.startsWith(rootResolved + sep);
}

async function streamFile(res: Response, abs: string, contentType: string): Promise<boolean> {
  let size: number;
  try {
    const s = await stat(abs);
    if (!s.isFile()) return false;
    size = s.size;
  } catch {
    return false;
  }
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(size));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  await new Promise<void>((resolveP, rejectP) => {
    const stream = createReadStream(abs);
    stream.on('error', rejectP);
    stream.on('end', () => resolveP());
    stream.pipe(res);
  });
  return true;
}

/** GET /photos/:name — flat dir, traversal-safe, auth-gated outside demo. */
export function registerPhotoRoute(app: Express, ctx: AppContext): void {
  const { config } = ctx;
  const photosRoot = resolve(join(config.dataDir, 'photos'));

  const guard = config.demo
    ? (_req: Request, _res: Response, next: NextFunction) => next()
    : requireAuth;

  // ':name' captures a single segment only; a nested sub-path won't match this
  // route and falls through to the JSON 404. We still decode + re-check below
  // for encoded traversal that slips a separator into the segment.
  app.get('/photos/:name', guard, async (req, res) => {
    const raw = req.params.name;
    if (typeof raw !== 'string') {
      res.status(400).json({ error: 'bad photo name' });
      return;
    }
    let name: string;
    try {
      name = decodeURIComponent(raw);
    } catch {
      res.status(400).json({ error: 'bad photo name' });
      return;
    }
    // Reject any separators or parent refs in the (decoded) name outright.
    if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
      res.status(400).json({ error: 'bad photo name' });
      return;
    }
    const ext = extname(name).toLowerCase();
    const contentType = PHOTO_CONTENT_TYPES[ext];
    if (!contentType) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const abs = resolve(join(photosRoot, name));
    if (!isInside(photosRoot, abs)) {
      res.status(400).json({ error: 'bad photo name' });
      return;
    }
    const ok = await streamFile(res, abs, contentType);
    if (!ok) res.status(404).json({ error: 'not found' });
  });
}

/**
 * Serve the built SPA from `config.clientDir` (dist/ui) with history-fallback.
 * Registered LAST (after the API JSON-404), and it explicitly ignores /api and
 * /photos so it can never hijack them. A request for a real asset streams that
 * file; anything else returns index.html so the client router takes over. If no
 * client build is configured, this is a no-op (the global JSON 404 wins).
 */
export function registerSpaStatic(app: Express, ctx: AppContext): void {
  const clientDir = ctx.config.clientDir;
  if (!clientDir) return;
  const root = resolve(clientDir);
  const indexHtml = join(root, 'index.html');

  app.get(/.*/, async (req, res, next) => {
    // Never touch the API or photo namespaces (defense in depth — these are
    // already handled above, but a stray match must fall through to JSON 404).
    if (req.path.startsWith('/api') || req.path.startsWith('/photos')) return next();

    // Try the requested path as a real built asset (only when it has a file
    // extension — extensionless paths are client routes, served the SPA shell).
    const rel = normalize(decodeURIComponent(req.path)).replace(/^(\.\.[/\\])+/, '');
    if (extname(rel)) {
      const assetAbs = resolve(join(root, rel));
      if (isInside(root, assetAbs)) {
        const ct = SPA_ASSET_CONTENT_TYPES[extname(rel).toLowerCase()] ?? 'application/octet-stream';
        const served = await streamFile(res, assetAbs, ct);
        if (served) return;
      }
    }

    // History fallback: serve the SPA shell for any client route.
    const served = await streamFile(res, indexHtml, 'text/html; charset=utf-8');
    if (!served) next();
  });
}
