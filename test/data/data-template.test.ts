import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { loadDataset } from '../../src/data/dataset.js';
import { boatSchema } from '../../src/data/schema.js';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = join(ROOT, 'data-template');

/** The on-disk collection directories the loader scans. */
const COLLECTION_DIRS = ['trips', 'maintenance', 'costs', 'vendors', 'inventory', 'manuals'];

describe('data-template scaffold', () => {
  it('loads as a valid, completely empty dataset', async () => {
    const ds = await loadDataset(TEMPLATE);
    // Every record collection is present but empty — a fresh seed has no records.
    expect(ds.trips).toEqual([]);
    expect(ds.maintenance).toEqual([]);
    expect(ds.costs).toEqual([]);
    expect(ds.vendors).toEqual([]);
    expect(ds.inventory).toEqual([]);
    expect(ds.manuals).toEqual([]);
    expect(ds.quickref).toEqual([]);
  });

  it('has a placeholder boat that validates against boatSchema and carries the full key structure', async () => {
    const ds = await loadDataset(TEMPLATE);
    // loadDataset already parses boat through boatSchema; assert the shape a
    // forker fills in is all present (so the scaffold teaches the schema).
    // `name` is required; the optional string fields are present-but-empty so
    // the forker sees them. `year` is a NUMBER in the schema (no empty-number
    // placeholder exists), so it is documented-but-omitted, not a null/'' that
    // would fail validation.
    expect(ds.boat.name).toBeTypeOf('string');
    expect(ds.boat.name.length).toBeGreaterThan(0);
    expect(ds.boat.make).toBe('');
    expect(ds.boat.model).toBe('');
    expect(ds.boat.hailingPort).toBe('');
    expect(ds.boat.specs).toEqual({});
    expect(ds.boat.welcome).toEqual({
      rules: [],
      whatToExpect: '',
      whatToBring: [],
      safety: '',
    });
    // Re-validate the raw file directly so a hand-edit that breaks the schema fails here.
    const raw = parseYaml(readFileSync(join(TEMPLATE, 'boat.yaml'), 'utf8'));
    expect(boatSchema.safeParse(raw).success).toBe(true);
  });

  it('keeps every collection dir + photos present in git via .gitkeep and genuinely empty of records', () => {
    for (const sub of [...COLLECTION_DIRS, 'photos']) {
      const dir = join(TEMPLATE, sub);
      expect(existsSync(dir), `${sub}/ should exist`).toBe(true);
      expect(existsSync(join(dir, '.gitkeep')), `${sub}/.gitkeep should exist`).toBe(true);
      // No record files (*.md) live directly in a collection dir — it is a pure scaffold.
      const records = readdirSync(dir).filter((f) => f.endsWith('.md'));
      expect(records, `${sub}/ must hold no record files`).toEqual([]);
    }
  });

  it('keeps examples out of the loader path: one commented example per collection lives under examples/', () => {
    const examplesDir = join(TEMPLATE, 'examples');
    expect(existsSync(examplesDir)).toBe(true);
    const exampleFiles = readdirSync(examplesDir).filter((f) => f.endsWith('.md'));
    // One worked example per record collection.
    expect(exampleFiles.length).toBe(COLLECTION_DIRS.length);
    // The loader NEVER scans examples/, so its presence cannot pollute the dataset.
    // (Proven by the all-empty load test above — examples sit outside every collection dir.)
    expect(statSync(examplesDir).isDirectory()).toBe(true);
  });
});
