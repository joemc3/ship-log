import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { parseRecord } from '../../src/data/record.js';
import { tripSchema, maintenanceSchema } from '../../src/data/schema.js';
import { deriveId } from '../../src/data/write.js';
import { checkLinkIntegrity } from '../../src/data/links.js';
import { MONETARY_FIELDS } from '../../src/data/monetary.js';
import type { Dataset } from '../../src/data/dataset.js';

/**
 * SKILL OUTPUT-CONTRACT (t9).
 *
 * The `complete-trip` skill turns the half-written-trip FIXTURE
 * (`data-template/examples/half-written-trip/`) into two finished records: the
 * trip with a real narrative + a linked finding, and a NEW maintenance record
 * carrying the two-way cross-link back to the trip. This test hand-produces
 * exactly the records a correct run should yield and proves, through the data
 * layer itself, that they satisfy the contract the skill promises:
 *
 *   1. both records pass their Zod schemas (the loader would accept them);
 *   2. `checkLinkIntegrity` reports ZERO broken links across trip ↔ maintenance
 *      ↔ vendor (both directions of the cross-link resolve);
 *   3. `deriveId` mints the EXACT maintenance id the skill is told to mint from
 *      the maintenance `title` (the file name the skill writes);
 *   4. the maintenance record carries NO monetary field — a crew-authored trip
 *      completion never introduces a `costEst`.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = join(ROOT, 'data-template', 'examples', 'half-written-trip');

const TRIP_ID = 't-2026-06-14';
// The skill derives this id from the maintenance title; asserted against deriveId below.
const MAINT_TITLE = 'Replace raw-water impeller';
const MAINT_ID = 'm-replace-raw-water-impeller';

describe('skill output-contract — the half-written-trip FIXTURE is genuinely sparse', () => {
  it('exists and is a valid but unfinished trip: a finding with no maintId yet', () => {
    const file = join(FIXTURE, `${TRIP_ID}.md`);
    expect(existsSync(file), 'fixture trip should exist').toBe(true);
    const { data, body } = parseRecord(readFileSync(file, 'utf8'));
    const parsed = tripSchema.safeParse(data);
    expect(parsed.success, 'a partial trip is still schema-valid').toBe(true);
    const trip = parsed.data!;
    // Starting state: one finding, NOT yet linked to a maintenance record.
    const findings = trip.findings ?? [];
    expect(findings).toHaveLength(1);
    expect(findings[0]?.maintId).toBeUndefined();
    // And the body is a throwaway line, not a real narrative — there's work to do.
    expect(body.length).toBeLessThan(120);
  });

  it('the fixture ships a photo placeholder and a manual to research against', () => {
    expect(existsSync(join(FIXTURE, 'photos', 't-2026-06-14-01.jpg'))).toBe(true);
    const manual = join(FIXTURE, 'manuals', 'man-engine.md');
    expect(existsSync(manual)).toBe(true);
    // The manual carries real reference text for the system the trip surfaced.
    expect(readFileSync(manual, 'utf8').toLowerCase()).toContain('impeller');
  });
});

/** The two records a correct `complete-trip` run produces from the fixture. */
const finishedTrip = {
  id: TRIP_ID,
  title: 'Bay shakedown',
  date: '2026-06-14',
  crew: ['Skipper', 'First Mate'],
  engineHrs: 1.5,
  photos: ['photos/t-2026-06-14-01.jpg'],
  findings: [
    {
      text:
        'Engine temp climbed on the motor back in — raw-water flow looked weak at the exhaust.',
      severity: 'medium' as const,
      // Now linked to the maintenance record the skill opens (direction 1 of 2).
      maintId: MAINT_ID,
    },
  ],
  body:
    'Motored out of the fairway in light air, sailed the bay on a beam reach, then ' +
    'motored home. On the way in the engine temperature climbed and the exhaust ' +
    'stream went weak — shut down and sailed the last stretch to be safe. Squawked ' +
    'it for the maintenance list; the engine manual points at the raw-water impeller.',
};

const finishedMaintenance = {
  id: MAINT_ID,
  title: MAINT_TITLE,
  system: 'Engine',
  status: 'due' as const,
  priority: 1,
  opened: '2026-06-14',
  due: '2026-07-14',
  // Cross-link back to the originating trip (direction 2 of 2).
  fromTripId: TRIP_ID,
  body:
    'Weak raw-water flow and a rising engine temp on the 2026-06-14 shakedown. ' +
    'The engine manual (raw-water cooling / impeller service) points first at a ' +
    'worn impeller. Close the seacock, pull the pump cover, swap the impeller, ' +
    'account for any lost vanes in the heat exchanger, and confirm a strong ' +
    'exhaust stream before getting under way.',
};

describe('skill output-contract — the finished records satisfy the schema + link contract', () => {
  it('the finished trip passes tripSchema (frontmatter minus body)', () => {
    const { body, ...frontmatter } = finishedTrip;
    expect(body.length).toBeGreaterThan(120); // a real narrative now
    expect(tripSchema.safeParse(frontmatter).success).toBe(true);
  });

  it('the finished maintenance record passes maintenanceSchema', () => {
    const { body, ...frontmatter } = finishedMaintenance;
    expect(body.length).toBeGreaterThan(0);
    expect(maintenanceSchema.safeParse(frontmatter).success).toBe(true);
  });

  it('deriveId mints exactly the maintenance id the skill writes (from the title)', () => {
    // No collisions in a fresh repo → the bare slug.
    expect(deriveId('maintenance', { title: MAINT_TITLE }, new Set())).toBe(MAINT_ID);
  });

  it('checkLinkIntegrity reports ZERO broken links — both directions resolve', () => {
    const ds = {
      boat: { name: 'Test' },
      trips: [finishedTrip],
      maintenance: [finishedMaintenance],
      costs: [],
      vendors: [],
      inventory: [],
      manuals: [],
      quickref: [],
    } as unknown as Dataset;
    expect(checkLinkIntegrity(ds)).toEqual([]);
  });

  it('a dangling link (maintenance present but the back-link missing) IS reported — proving the check has teeth', () => {
    // Trip finding points at a maintenance id that is NOT in the dataset.
    const ds = {
      boat: { name: 'Test' },
      trips: [finishedTrip],
      maintenance: [], // the linked record is absent
      costs: [],
      vendors: [],
      inventory: [],
      manuals: [],
      quickref: [],
    } as unknown as Dataset;
    const broken = checkLinkIntegrity(ds);
    expect(broken).toContainEqual({ from: TRIP_ID, field: 'findings.maintId', target: MAINT_ID });
  });

  it('the crew-authored maintenance record carries NO monetary field', () => {
    const monetaryForMaint = MONETARY_FIELDS.maintenance ?? [];
    expect(monetaryForMaint).toContain('costEst'); // sanity: costEst IS the monetary field
    for (const field of monetaryForMaint) {
      expect(
        Object.prototype.hasOwnProperty.call(finishedMaintenance, field),
        `a crew completion must not author the monetary field ${field}`,
      ).toBe(false);
    }
    // And no dollar amount leaked into any crew-facing prose (trip body / finding / maint body).
    const findingText = finishedTrip.findings.map((f) => f.text).join('\n');
    const prose = [finishedTrip.body, findingText, finishedMaintenance.body].join('\n');
    expect(prose).not.toMatch(/\$\s?\d/);
  });
});
