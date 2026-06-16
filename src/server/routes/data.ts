import type { Express, Request } from 'express';
import type { AppContext } from '../app.js';
import { requireAuth, requireOwner } from '../middleware.js';
import { redactDataset } from '../redact.js';
import { search as searchData, deriveInventoryTasks, deriveAttention } from '../../data/index.js';

export function registerDataRoutes(app: Express, ctx: AppContext): void {
  const { store, now } = ctx;
  const view = (req: Request) => redactDataset(store.current(), req.viewer.role);

  app.get('/api/boat', requireAuth, (req, res) => res.json(view(req).boat));

  app.get('/api/trips', requireAuth, (req, res) => res.json(view(req).trips));
  app.get('/api/trips/:id', requireAuth, (req, res) => {
    const t = view(req).trips.find((x) => x.id === req.params.id);
    if (t) res.json(t); else res.status(404).json({ error: 'not found' });
  });

  app.get('/api/maintenance', requireAuth, (req, res) => res.json(view(req).maintenance));
  app.get('/api/maintenance/:id', requireAuth, (req, res) => {
    const m = view(req).maintenance.find((x) => x.id === req.params.id);
    if (m) res.json(m); else res.status(404).json({ error: 'not found' });
  });

  app.get('/api/inventory', requireAuth, (req, res) => res.json(view(req).inventory));
  app.get('/api/vendors', requireAuth, (req, res) => res.json(view(req).vendors));
  app.get('/api/manuals', requireAuth, (req, res) => res.json(view(req).manuals));
  app.get('/api/quickref', requireAuth, (req, res) => res.json(view(req).quickref));

  // Owner-only collection. requireOwner => 403 for crew/guest.
  app.get('/api/costs', requireOwner, (_req, res) => res.json(store.current().costs));
  app.get('/api/costs/:id', requireOwner, (req, res) => {
    const c = store.current().costs.find((x) => x.id === req.params.id);
    if (c) res.json(c); else res.status(404).json({ error: 'not found' });
  });

  app.get('/api/search', requireAuth, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(searchData(view(req), q)); // search over the redacted view: no cost hits, no monetary values
  });

  app.get('/api/derived', requireAuth, (req, res) => {
    const v = view(req);
    const clock = now();
    res.json({ attention: deriveAttention(v, clock), inventoryTasks: deriveInventoryTasks(v, clock) });
  });
}
