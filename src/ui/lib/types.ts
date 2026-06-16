/**
 * The SPA's view of the record shapes — re-exported (TYPE-ONLY) from the
 * authoritative server schema so the UI and API never drift. `import type`
 * keeps the zod runtime (and the whole data layer) out of the browser bundle:
 * only the inferred TS types cross over.
 *
 * Bind to THESE, not the prototype's richer mock window.DATA shapes (e.g. the
 * prototype's inventory.service was {task,next}; the real schema's inspect/
 * service/expires are bare ISO date strings).
 */
import type {
  Trip,
  Maintenance,
  MaintStatus,
  Inventory,
  Vendor,
  Manual,
  Cost,
  Boat,
} from '../../data/schema.js';
import type { WithBody } from '../../data/dataset.js';
import type { SearchHit } from '../../data/search.js';
import type { InventoryTask, InventoryTaskKind, TaskStatus } from '../../data/derive.js';

export type {
  Trip,
  Maintenance,
  MaintStatus,
  Inventory,
  Vendor,
  Manual,
  Cost,
  Boat,
  WithBody,
  SearchHit,
  InventoryTask,
  InventoryTaskKind,
  TaskStatus,
};

/** A single quick-reference card. The data layer parses `quickref.yaml` as a
 *  whole array (`Quickref`); the API serves that array, and the UI consumes one
 *  card at a time, so we name the element type here. */
export interface Quickref {
  id: string;
  title: string;
  body?: string;
}

/** Records as they arrive over the wire: frontmatter + the Markdown `body`. */
export type TripRec = WithBody<Trip>;
export type MaintenanceRec = WithBody<Maintenance>;
export type InventoryRec = WithBody<Inventory>;
export type VendorRec = WithBody<Vendor>;
export type ManualRec = WithBody<Manual>;
export type CostRec = WithBody<Cost>;

/** The viewer's role + roles, mirroring the server (never read from the cookie). */
export type Role = 'owner' | 'crew' | 'guest';

/** GET /api/me — role/demo discovery. NEVER 401s. */
export interface Me {
  role: Role;
  username: string | null;
  demo: boolean;
  ownerConfigured: boolean;
}

/** GET /api/welcome — the only block a guest may see. */
export interface Welcome {
  name: string;
  make?: string;
  model?: string;
  year?: number;
  hailingPort?: string;
  welcome: {
    rules?: string[];
    whatToExpect?: string;
    whatToBring?: string[];
    safety?: string;
  };
}

/** GET /api/derived — server-computed against the real clock. */
export interface Derived {
  attention: number;
  inventoryTasks: InventoryTask[];
}

/** POST /api/login response. */
export interface LoginResult {
  username: string;
  role: Role;
}

/** A user account as the admin list serves it (NO password hash ever crosses
 *  the wire). Roles are restricted to the assignable set (owner|crew) — `guest`
 *  is the absence of an account, never a stored role. */
export type AssignableRole = 'owner' | 'crew';
export interface User {
  username: string;
  role: AssignableRole;
}
