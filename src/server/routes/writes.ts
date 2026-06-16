import type { Express, Request, Response, RequestHandler } from 'express';
import multer from 'multer';
import type { AppContext } from '../app.js';
import { requireAuth, requireOwner, denyInDemo } from '../middleware.js';
import { redactRecord } from '../redact.js';
import { WriteError } from '../store.js';
import { PhotoError } from '../photos.js';
import { COLLECTION_DIR, type CollectionName } from '../../data/index.js';

// memoryStorage → req.file.buffer; the hard cap is defense-in-depth (the app-level
// 25 MB / type checks live in photos.ts and yield 413/415).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// Multer errors (oversized, wrong field) throw inside the middleware, bypassing the
// route try/catch. Map them to client-facing statuses instead of a generic 500.
const acceptPhoto: RequestHandler = (req, res, next) =>
  upload.single('photo')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'image exceeds the upload size limit' : `upload error: ${err.message}`;
      return fail(res, new PhotoError(message, status));
    }
    return next(err);
  });

/** Commit author from the logged-in user (fallback to a generic app identity). */
function authorFor(req: Request): { name: string; email: string } {
  const name = req.viewer.username ?? "Ship's Log";
  return { name, email: `${name.replace(/\s+/g, '-').toLowerCase()}@shiplog.local` };
}

function fail(res: Response, err: unknown): void {
  if (err instanceof WriteError || err instanceof PhotoError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal error' });
}

export function registerWriteRoutes(app: Express, ctx: AppContext): void {
  const { store, config } = ctx;
  const noDemo = denyInDemo(config);

  // ---- Trips: crew + owner ----
  app.post('/api/trips', requireAuth, noDemo, async (req, res) => {
    const { body: narrative, ...fields } = req.body ?? {};
    try {
      const rec = await store.createRecord('trip', fields, typeof narrative === 'string' ? narrative : '', authorFor(req));
      res.status(201).json(redactRecord('trip', rec, req.viewer.role));
    } catch (err) { fail(res, err); }
  });

  app.put('/api/trips/:id', requireAuth, noDemo, async (req, res) => {
    try {
      const rec = await store.updateRecord('trip', req.params.id as string, req.body ?? {}, authorFor(req));
      res.json(redactRecord('trip', rec, req.viewer.role));
    } catch (err) { fail(res, err); }
  });

  // ---- Maintenance complete: crew + owner (narrow op — never touches costEst) ----
  app.post('/api/maintenance/:id/complete', requireAuth, noDemo, async (req, res) => {
    const { completed, note } = req.body ?? {};
    try {
      const rec = await store.completeMaintenance(req.params.id as string, { completed, note }, authorFor(req));
      res.json(redactRecord('maintenance', rec, req.viewer.role));
    } catch (err) { fail(res, err); }
  });

  // ---- Owner-only create/edit for the remaining collections ----
  const OWNER_WRITABLE: CollectionName[] = ['maintenance', 'inventory', 'vendor', 'cost', 'manual'];
  for (const collection of OWNER_WRITABLE) {
    const base = `/api/${COLLECTION_DIR[collection]}`;
    app.post(base, requireOwner, noDemo, async (req, res) => {
      const { body: narrative, ...fields } = req.body ?? {};
      try {
        const rec = await store.createRecord(collection, fields, typeof narrative === 'string' ? narrative : '', authorFor(req));
        res.status(201).json(redactRecord(collection, rec, req.viewer.role));
      } catch (err) { fail(res, err); }
    });
    app.put(`${base}/:id`, requireOwner, noDemo, async (req, res) => {
      try {
        const rec = await store.updateRecord(collection, req.params.id as string, req.body ?? {}, authorFor(req));
        res.json(redactRecord(collection, rec, req.viewer.role));
      } catch (err) { fail(res, err); }
    });
  }

  // ---- Deletes: owner-only, every collection (including trips) ----
  const ALL: CollectionName[] = ['trip', 'maintenance', 'inventory', 'vendor', 'cost', 'manual'];
  for (const collection of ALL) {
    app.delete(`/api/${COLLECTION_DIR[collection]}/:id`, requireOwner, noDemo, async (req, res) => {
      try {
        await store.deleteRecord(collection, req.params.id as string, authorFor(req));
        res.status(204).end();
      } catch (err) { fail(res, err); }
    });
  }

  // ---- Photos: crew + owner (multipart field "photo") ----
  app.post('/api/photos', requireAuth, noDemo, acceptPhoto, async (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'multipart file field "photo" required' }); return; }
    try {
      const out = await store.savePhoto(req.file.buffer, req.file.mimetype, authorFor(req));
      res.status(201).json(out);
    } catch (err) { fail(res, err); }
  });
}
