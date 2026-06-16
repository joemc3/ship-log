import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describeSchema } from '../../src/data/describe.js';

/**
 * P3 DOC-DRIFT GOLDEN — the P3 analogue of `redaction-golden`.
 *
 * The Cowork-facing docs (`AGENTS.md`, `SCHEMA.md`, and the `complete-trip`
 * skill) are authored CANONICALLY under `data-template/` and BYTE-COPIED into
 * `demo/`. They teach humans/Cowork the data model by hand, so they CAN drift
 * from the code that actually enforces it. This single guard makes that
 * impossible to do silently:
 *
 *  1. Every load-bearing token the data layer owns — collection dir, id prefix,
 *     monetary field, owner-only collection, cross-link field, and every status /
 *     severity / waypoint enum (all read back from the `describe.ts` descriptor,
 *     never hand-transcribed) — MUST appear verbatim in `SCHEMA.md`.
 *  2. NO monetary field may be omitted from `SCHEMA.md`'s monetary section.
 *  3. The `demo/` copies of `AGENTS.md`, `SCHEMA.md`, and the skill MUST be
 *     byte-identical to the `data-template/` canonicals.
 *
 * Keep it green; never weaken it. When you add a cost-bearing / cross-link /
 * collection field, update schema.ts + monetary.ts + SCHEMA.md + AGENTS.md in the
 * SAME change and this guard proves the docs were updated too.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = join(ROOT, 'data-template');
const DEMO = join(ROOT, 'demo');

const SCHEMA_REL = 'SCHEMA.md';
const AGENTS_REL = 'AGENTS.md';
const SKILL_REL = join('.claude', 'skills', 'complete-trip', 'SKILL.md');

const schemaText = readFileSync(join(TEMPLATE, SCHEMA_REL), 'utf8');
const desc = describeSchema();

/** The exact heading of SCHEMA.md's monetary section, plus the prose that follows
 *  it up to the next top-level `##` heading. Every monetary field must be named
 *  inside this slice — not merely somewhere else in the document. */
function monetarySection(text: string): string {
  const start = text.indexOf('## Money is owner-only');
  expect(start, 'SCHEMA.md must have a "## Money is owner-only" section').toBeGreaterThan(-1);
  const after = text.indexOf('\n## ', start + 1);
  return after === -1 ? text.slice(start) : text.slice(start, after);
}

describe('P3 doc-drift golden — SCHEMA.md mirrors the data-layer source of truth', () => {
  it('names every collection by its on-disk directory', () => {
    for (const c of desc.collections) {
      expect(schemaText, `collection dir ${c.dir}/`).toContain(`${c.dir}/`);
    }
  });

  it('spells out every id prefix as a backticked token', () => {
    for (const c of desc.collections) {
      expect(schemaText, `id prefix \`${c.idPrefix}\``).toContain(`\`${c.idPrefix}`);
    }
  });

  it('names every cross-link field (verbatim) with its target collection', () => {
    for (const link of desc.crossLinks) {
      // Use the leaf token (e.g. `findings.maintId` → `maintId`) so the assertion
      // matches however the prose phrases the path.
      const fieldToken = link.field.includes('.') ? link.field.split('.').pop()! : link.field;
      expect(schemaText, `cross-link field ${link.field}`).toContain(fieldToken);
      expect(schemaText, `cross-link target ${link.target}`).toContain(link.target);
    }
  });

  it('lists every status / severity / waypoint enum option exactly', () => {
    // Top-level enum fields, read straight off the descriptor.
    for (const c of desc.collections) {
      for (const f of c.fields) {
        if (f.type === 'enum' && f.enum) {
          for (const opt of f.enum) {
            expect(schemaText, `${c.name}.${f.name} enum option ${opt}`).toContain(opt);
          }
        }
      }
    }
    // Nested-array enums the descriptor does not surface at top level — assert
    // them explicitly so a future rename of waypoint.type / finding.severity is
    // caught here too.
    for (const opt of ['depart', 'anchor', 'arrive', 'waypoint']) {
      expect(schemaText, `waypoint type ${opt}`).toContain(opt);
    }
    for (const opt of ['low', 'medium', 'high']) {
      expect(schemaText, `finding severity ${opt}`).toContain(opt);
    }
  });

  it('names the owner-only collection and states the invariant in words', () => {
    expect(desc.ownerOnlyCollections).toEqual(['cost']);
    for (const name of desc.ownerOnlyCollections) {
      const dir = desc.collections.find((c) => c.name === name)!.dir;
      expect(schemaText, `owner-only collection ${dir}/`).toContain(`${dir}/`);
    }
    const flat = schemaText.toLowerCase().replace(/\s+/g, ' ');
    expect(flat).toContain('owner-only');
    // Costs must be taught as never-echoed-to-crew (the redaction-can't-reach-prose rule).
    expect(flat).toMatch(/never .*(crew|narrativ)/);
  });

  it('omits NO monetary field from the monetary section', () => {
    const section = monetarySection(schemaText);
    for (const [coll, fields] of Object.entries(desc.monetaryFields)) {
      for (const field of fields) {
        expect(section, `monetary field ${coll}.${field} must appear in the monetary section`)
          .toContain(field);
      }
    }
    // Belt-and-suspenders: the section must name the owner-only collection too.
    expect(section).toContain('cost');
  });
});

describe('P3 doc-drift golden — demo/ is a byte-for-byte copy of data-template/', () => {
  for (const rel of [SCHEMA_REL, AGENTS_REL, SKILL_REL]) {
    it(`demo/${rel} is byte-identical to data-template/${rel}`, () => {
      const canonical = readFileSync(join(TEMPLATE, rel));
      const mirror = readFileSync(join(DEMO, rel));
      // Buffer equality => byte-for-byte (catches whitespace/encoding drift).
      expect(mirror.equals(canonical)).toBe(true);
    });
  }
});
