/**
 * The assistant API (`/api/assistant/*`). A NO-OP when the feature is unconfigured:
 * with no `ctx.assistant`, nothing is registered, so the paths fall through to the
 * standard JSON 404. Handlers are added in the next task.
 */
import type { Express } from 'express';
import type { AppContext } from '../app.js';

export function registerAssistantRoutes(app: Express, ctx: AppContext): void {
  const { assistant } = ctx;
  if (!assistant) return; // feature OFF — register nothing
  void app; // handlers added in Task 5
}
