import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, sep, extname, normalize, basename } from 'node:path';
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

/** Content types for served manual files (the records' `file:` field). Scoped to
 *  document-ish types — manuals carry NO monetary data, so this route is safe for
 *  the redaction-golden invariant; it is NOT a generic data-dir file server. */
const MANUAL_CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
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
 * GET /api/welcome/hero — stream the boat's hero photo for the PUBLIC welcome
 * page. This is the ONE photo surface with NO auth guard, exactly like
 * GET /api/welcome: the welcome page is the guest-facing surface, and the
 * auth-gated /photos/:name route cannot serve it to a guest outside demo mode.
 *
 * The served file is the boat's `heroPhoto` (a repo-relative path like
 * `photos/boat-hero.jpg`). We reduce it to a single basename (tolerating a
 * leading `photos/`), reject traversal/null bytes, resolve it strictly inside
 * <dataDir>/photos/, and stream it. 404 if no hero is configured or the file is
 * missing. The hero is identity, not money — it carries no monetary data, so this
 * route is safe for the redaction-golden invariant.
 *
 * Registered BEFORE the /api JSON-404 so it is matched (and never shadowed).
 */
export function registerWelcomeHeroRoute(app: Express, ctx: AppContext): void {
  const { config, store } = ctx;
  const photosRoot = resolve(join(config.dataDir, 'photos'));

  app.get('/api/welcome/hero', async (_req, res) => {
    const heroPhoto = store.current().boat.heroPhoto;
    if (typeof heroPhoto !== 'string' || heroPhoto === '') {
      res.status(404).json({ error: 'no hero photo' });
      return;
    }
    // Reduce to a single segment (tolerate a `photos/` prefix), then re-check for
    // any traversal/null bytes the basename couldn't have stripped.
    const name = basename(heroPhoto);
    if (name.includes('..') || name.includes('\0')) {
      res.status(400).json({ error: 'bad hero photo' });
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
      res.status(400).json({ error: 'bad hero photo' });
      return;
    }
    const ok = await streamFile(res, abs, contentType);
    if (!ok) res.status(404).json({ error: 'not found' });
  });
}

/**
 * GET /files/manuals/:name — stream a manual file from <dataDir>/manuals/ (the
 * demo dir in demo mode). Mirrors the photo route's hardening: a single path
 * segment (no nesting), decoded + re-checked for traversal, content-typed from a
 * document allowlist, and the SAME auth posture as reads (open in demo,
 * requireAuth otherwise).
 *
 * Deliberately SCOPED to manuals/ only — it is NOT a generic data-dir file
 * server, so it can never reach costs/*.md (the redaction-golden invariant stays
 * intact; manuals carry no monetary data). Registered to never shadow /api or
 * /photos, and the /files namespace is JSON-404'd before the SPA fallback.
 */
export function registerManualRoute(app: Express, ctx: AppContext): void {
  const { config } = ctx;
  const manualsRoot = resolve(join(config.dataDir, 'manuals'));

  const guard = config.demo
    ? (_req: Request, _res: Response, next: NextFunction) => next()
    : requireAuth;

  // ':name' captures a single segment only; a nested sub-path won't match and
  // falls through to the /files JSON 404. We still decode + re-check for encoded
  // traversal that slips a separator into the segment.
  app.get('/files/manuals/:name', guard, async (req, res) => {
    const raw = req.params.name;
    if (typeof raw !== 'string') {
      res.status(400).json({ error: 'bad manual name' });
      return;
    }
    let name: string;
    try {
      name = decodeURIComponent(raw);
    } catch {
      res.status(400).json({ error: 'bad manual name' });
      return;
    }
    if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
      res.status(400).json({ error: 'bad manual name' });
      return;
    }
    const ext = extname(name).toLowerCase();
    const contentType = MANUAL_CONTENT_TYPES[ext];
    if (!contentType) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const abs = resolve(join(manualsRoot, name));
    if (!isInside(manualsRoot, abs)) {
      res.status(400).json({ error: 'bad manual name' });
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
    // Never touch the API, photo, or served-file namespaces (defense in depth —
    // these are already handled above, but a stray match must fall through to a
    // JSON 404 rather than serving index.html for an API/asset request).
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/photos') ||
      req.path.startsWith('/files')
    ) {
      return next();
    }

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
