import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describeSchema } from '../../src/data/describe.js';

/**
 * SCHEMA.md is authored CANONICALLY under data-template/ and BYTE-COPIED into
 * demo/. These tests are the guard that (1) the two copies can never diverge and
 * (2) the document can never silently drift from the data-layer source of truth:
 * every collection, field, enum, monetary tag, id rule, cross-link, and derived
 * fact in `describeSchema()` must be spelled out in the prose. The doc is
 * hand-written (so it can teach), but each load-bearing token is checked here.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_DOC = join(ROOT, 'data-template', 'SCHEMA.md');
const DEMO_DOC = join(ROOT, 'demo', 'SCHEMA.md');

const templateText = readFileSync(TEMPLATE_DOC, 'utf8');
const desc = describeSchema();

describe('SCHEMA.md — byte-identical template/demo copies', () => {
  it('demo/SCHEMA.md is a byte-for-byte copy of data-template/SCHEMA.md', () => {
    const templateBytes = readFileSync(TEMPLATE_DOC);
    const demoBytes = readFileSync(DEMO_DOC);
    expect(demoBytes.equals(templateBytes)).toBe(true);
  });
});

describe('SCHEMA.md — mirrors the data-layer descriptor (no drift)', () => {
  it('documents every per-record collection and its on-disk dir', () => {
    for (const c of desc.collections) {
      expect(templateText, `collection ${c.name}`).toContain(c.name);
      expect(templateText, `dir ${c.dir}/`).toContain(`${c.dir}/`);
    }
  });

  it('documents the id prefix and slug-source field for every collection', () => {
    for (const c of desc.collections) {
      // The prefix appears as a backticked token, e.g. `m-` / `inv-` / `t-`.
      expect(templateText, `prefix ${c.idPrefix}`).toContain(`\`${c.idPrefix}`);
      // The slug-source field name is named in prose for each collection.
      expect(templateText, `slug source ${c.name}.${c.slugSource}`).toContain(c.slugSource);
    }
  });

  it('documents the t-<date> rule and -2/-3 collision suffix', () => {
    expect(templateText).toContain('t-<date>');
    expect(templateText).toMatch(/-2/);
    expect(templateText).toMatch(/-3/);
  });

  it('documents every field name of every collection', () => {
    for (const c of desc.collections) {
      for (const f of c.fields) {
        expect(templateText, `field ${c.name}.${f.name}`).toContain(f.name);
      }
    }
  });

  it('documents every enum option exactly as defined in the schema', () => {
    for (const c of desc.collections) {
      for (const f of c.fields) {
        if (f.type === 'enum' && f.enum) {
          for (const opt of f.enum) {
            expect(templateText, `enum ${c.name}.${f.name} = ${opt}`).toContain(opt);
          }
        }
      }
    }
  });

  it('names the waypoint and finding-severity enums (nested array objects)', () => {
    // These live on nested objects, not top-level fields, so assert them explicitly.
    for (const opt of ['depart', 'anchor', 'arrive', 'waypoint']) {
      expect(templateText, `waypoint type ${opt}`).toContain(opt);
    }
    for (const opt of ['low', 'medium', 'high']) {
      expect(templateText, `severity ${opt}`).toContain(opt);
    }
  });

  it('tags every monetary field and the owner-only collection', () => {
    for (const [coll, fields] of Object.entries(desc.monetaryFields)) {
      for (const field of fields) {
        expect(templateText, `monetary ${coll}.${field}`).toContain(field);
      }
    }
    expect(desc.ownerOnlyCollections).toEqual(['cost']);
    // The doc must state plainly that costs are owner-only / never echoed to crew.
    // Normalize whitespace so the assertion is robust to line wrapping in the prose.
    const flat = templateText.toLowerCase().replace(/\s+/g, ' ');
    expect(flat).toContain('owner-only');
    expect(flat).toMatch(/never .*(crew|narrativ)/);
  });

  it('documents every cross-link with its field path and target collection', () => {
    for (const link of desc.crossLinks) {
      // e.g. "findings.maintId" / "vendorId" / "fromTripId" appear verbatim.
      const fieldToken = link.field.includes('.') ? link.field.split('.').pop()! : link.field;
      expect(templateText, `cross-link field ${link.field}`).toContain(fieldToken);
      expect(templateText, `cross-link target ${link.target}`).toContain(link.target);
    }
    // The doc must state that broken links are reported.
    expect(templateText.toLowerCase()).toMatch(/broken link/);
  });

  it('documents the derived-task facts (inventory date fields, due window, attention statuses)', () => {
    for (const kind of desc.derived.inventoryTaskKinds) {
      expect(templateText, `inventory task kind ${kind}`).toContain(kind);
    }
    for (const status of desc.derived.maintAttentionStatuses) {
      expect(templateText, `attention status ${status}`).toContain(status);
    }
    expect(templateText, 'due window days').toContain(String(desc.derived.dueWindowDays));
  });

  it('documents boat.yaml and quickref.yaml singletons and the photos[] / manuals file conventions', () => {
    expect(templateText).toContain('boat.yaml');
    expect(templateText).toContain('quickref.yaml');
    expect(templateText).toContain('photos/');
    // The qr- id prefix for quickref cards.
    expect(templateText).toContain('`qr-');
    // Manuals may carry a real PDF/text file to research against.
    expect(templateText.toLowerCase()).toContain('pdf');
  });
});
