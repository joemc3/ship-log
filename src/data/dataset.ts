import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { parseRecord } from './record.js';
import {
  boatSchema, tripSchema, maintenanceSchema, costSchema, vendorSchema,
  inventorySchema, manualSchema, quickrefSchema,
  type Boat, type Trip, type Maintenance, type Cost, type Vendor,
  type Inventory, type Manual, type Quickref,
} from './schema.js';

/** A record plus its Markdown body narrative. */
export type WithBody<T> = T & { body: string };

export interface Dataset {
  boat: Boat;
  trips: WithBody<Trip>[];
  maintenance: WithBody<Maintenance>[];
  costs: WithBody<Cost>[];
  vendors: WithBody<Vendor>[];
  inventory: WithBody<Inventory>[];
  manuals: WithBody<Manual>[];
  quickref: Quickref;
}

async function loadCollection<T>(dir: string, sub: string, schema: z.ZodType<T>): Promise<WithBody<T>[]> {
  let files: string[];
  try {
    files = (await readdir(join(dir, sub))).filter((f) => f.endsWith('.md'));
  } catch (err) {
    // A missing collection directory is fine (returns []); anything else
    // (permissions, not-a-directory, etc.) is a real error — rethrow it.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return [];
  }
  const out: WithBody<T>[] = [];
  for (const file of files.sort()) {
    const raw = await readFile(join(dir, sub, file), 'utf8');
    const { data, body } = parseRecord(raw);
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`Invalid record ${sub}/${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    }
    out.push({ ...(parsed.data as T), body });
  }
  return out;
}

export async function loadDataset(dir: string): Promise<Dataset> {
  const boatRaw = parseYaml(await readFile(join(dir, 'boat.yaml'), 'utf8'));
  const boat = boatSchema.parse(boatRaw);

  let quickref: Quickref = [];
  try {
    quickref = quickrefSchema.parse(parseYaml(await readFile(join(dir, 'quickref.yaml'), 'utf8')));
  } catch (err) {
    // quickref.yaml is optional: a MISSING file is fine, but a present-but-broken
    // file (bad YAML or schema-invalid) is a real error — rethrow it.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  return {
    boat,
    trips: await loadCollection(dir, 'trips', tripSchema),
    maintenance: await loadCollection(dir, 'maintenance', maintenanceSchema),
    costs: await loadCollection(dir, 'costs', costSchema),
    vendors: await loadCollection(dir, 'vendors', vendorSchema),
    inventory: await loadCollection(dir, 'inventory', inventorySchema),
    manuals: await loadCollection(dir, 'manuals', manualSchema),
    quickref,
  };
}
