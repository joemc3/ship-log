import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describeSchema } from '../../src/data/describe.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = join(ROOT, 'data-template');
const DEMO = join(ROOT, 'demo');

const desc = describeSchema();

/**
 * The Cowork-facing docs (AGENTS.md, and later SCHEMA.md + the skill) are
 * authored CANONICALLY under data-template/ and BYTE-COPIED into demo/. These
 * guards keep the two copies from drifting, and keep AGENTS.md honest against
 * the data-layer source of truth (the describe.ts descriptor) so a schema
 * rename can never silently leave the prose pointing at a stale dir / prefix.
 */
describe('Cowork docs — data-template ⇄ demo byte mirror', () => {
  it('demo/AGENTS.md is byte-identical to data-template/AGENTS.md', () => {
    const canonical = readFileSync(join(TEMPLATE, 'AGENTS.md'));
    const mirror = readFileSync(join(DEMO, 'AGENTS.md'));
    // Buffer equality => byte-for-byte (catches any whitespace/encoding drift).
    expect(mirror.equals(canonical)).toBe(true);
  });
});

describe('AGENTS.md — mirrors the schema descriptor (no drift)', () => {
  const agents = readFileSync(join(TEMPLATE, 'AGENTS.md'), 'utf8');

  it('names every collection by its on-disk directory', () => {
    for (const c of desc.collections) {
      expect(agents, `should mention the ${c.dir}/ directory`).toContain(`${c.dir}/`);
    }
  });

  it('documents every record-id prefix', () => {
    for (const c of desc.collections) {
      expect(agents, `should mention the ${c.idPrefix} id prefix`).toContain(c.idPrefix);
    }
  });

  it('flags the owner-only / monetary surface', () => {
    // Every owner-only collection dir must be called out as owner-sensitive.
    for (const name of desc.ownerOnlyCollections) {
      const dir = desc.collections.find((c) => c.name === name)!.dir;
      expect(agents).toContain(`${dir}/`);
    }
    // Every monetary field name must appear so the doc teaches the redaction set.
    for (const fields of Object.values(desc.monetaryFields)) {
      for (const field of fields) {
        expect(agents, `should mention the monetary field ${field}`).toContain(field);
      }
    }
    // And it must teach the core invariant in words.
    expect(agents.toLowerCase()).toContain('owner');
    expect(agents.toLowerCase()).toMatch(/redact|owner-sensitive|owner-only/);
  });

  it('points at SCHEMA.md for per-field detail rather than duplicating it', () => {
    expect(agents).toContain('SCHEMA.md');
  });
});
