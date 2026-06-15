import { z } from 'zod';

export const waypointSchema = z.object({
  name: z.string(),
  type: z.enum(['depart', 'anchor', 'arrive', 'waypoint']),
  time: z.string().optional(),
  note: z.string().optional(),
});

export const findingSchema = z.object({
  text: z.string(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  maintId: z.string().optional(),
});

export const tripSchema = z.object({
  id: z.string().regex(/^t-\d{4}-\d{2}-\d{2}(-.+)?$/),
  title: z.string().optional(),
  date: z.string(),
  durationHrs: z.number().optional(),
  distanceNm: z.number().optional(),
  engineHrs: z.number().optional(),
  sky: z.string().optional(),
  wind: z.string().optional(),
  seas: z.string().optional(),
  tempF: z.number().optional(),
  crew: z.array(z.string()).optional(),
  waypoints: z.array(waypointSchema).optional(),
  findings: z.array(findingSchema).optional(),
  photos: z.array(z.string()).optional(),
});
export type Trip = z.infer<typeof tripSchema>;

export const maintStatusSchema = z.enum(['overdue', 'due', 'scheduled', 'done']);

export const maintenanceSchema = z.object({
  id: z.string().regex(/^m-/),
  title: z.string(),
  system: z.string().optional(),
  status: maintStatusSchema,
  priority: z.number().int().optional(),
  opened: z.string().optional(),
  due: z.string().optional(),
  completed: z.string().nullable().optional(),
  costEst: z.number().optional(), // MONETARY — see monetary.ts
  vendorId: z.string().optional(),
  fromTripId: z.string().optional(),
  photos: z.array(z.string()).optional(),
});
export type Maintenance = z.infer<typeof maintenanceSchema>;
export type MaintStatus = z.infer<typeof maintStatusSchema>;

export const costSchema = z.object({
  id: z.string().regex(/^c-/),
  date: z.string(),
  category: z.string().optional(),
  item: z.string(),
  amount: z.number(), // MONETARY — see monetary.ts
  vendorId: z.string().optional(),
  maintId: z.string().optional(),
});
export type Cost = z.infer<typeof costSchema>;

export const vendorSchema = z.object({
  id: z.string().regex(/^v-/),
  name: z.string(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  url: z.string().optional(),
  services: z.array(z.string()).optional(),
});
export type Vendor = z.infer<typeof vendorSchema>;

export const inventorySchema = z.object({
  id: z.string().regex(/^inv-/),
  name: z.string(),
  category: z.string().optional(),
  location: z.string().optional(),
  count: z.number().optional(),
  level: z.string().optional(),
  condition: z.string().optional(),
  inspect: z.string().optional(),  // next inspection due (ISO date)
  service: z.string().optional(),  // next service due (ISO date)
  expires: z.string().optional(),  // expiry date (ISO date)
  photos: z.array(z.string()).optional(),
});
export type Inventory = z.infer<typeof inventorySchema>;

export const manualSchema = z.object({
  id: z.string().regex(/^man-/),
  title: z.string(),
  kind: z.string().optional(),
  file: z.string().optional(),
  sections: z.array(z.object({ title: z.string(), anchor: z.string().optional() })).optional(),
});
export type Manual = z.infer<typeof manualSchema>;

export const quickrefSchema = z.array(z.object({
  id: z.string().regex(/^qr-/),
  title: z.string(),
  body: z.string().optional(),
}));
export type Quickref = z.infer<typeof quickrefSchema>;

export const boatSchema = z.object({
  name: z.string(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().optional(),
  hailingPort: z.string().optional(),
  specs: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  welcome: z.object({
    rules: z.array(z.string()).optional(),
    whatToExpect: z.string().optional(),
    whatToBring: z.array(z.string()).optional(),
    safety: z.string().optional(),
  }).optional(),
});
export type Boat = z.infer<typeof boatSchema>;

/**
 * Per-collection record schemas, keyed by collection name (singular).
 * Excludes `quickref` (parsed as a whole array, not per-record) and `boat`
 * (a singleton config, not a record collection) — both are validated directly
 * by their own schemas, not via this map.
 */
export const collectionSchemas = {
  trip: tripSchema,
  maintenance: maintenanceSchema,
  cost: costSchema,
  vendor: vendorSchema,
  inventory: inventorySchema,
  manual: manualSchema,
} as const;
