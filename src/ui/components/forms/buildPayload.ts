/**
 * Turn flat form state into the API write payload.
 *
 * The contract the whole write layer leans on: PARTIAL ENTRIES ARE FIRST-CLASS.
 * A blank optional is OMITTED, never sent as `''` — so a trip with only a date
 * (and maybe a `body`) posts as `{ date }`, and the server fills in the rest.
 * `body` (the Markdown narrative) is left on the payload; the server splits it
 * out. Declared `numbers` are coerced (and dropped if unparseable, never NaN);
 * declared `arrays` are trimmed + compacted (empty → omitted); `objectArrays`
 * (repeatable groups like waypoints[]/findings[]/sections[]) drop fully-empty
 * rows and their own blank fields.
 *
 * This mirrors the Zod field shapes in `src/data/schema.ts` so the client builds
 * the same shape the server will validate.
 */

/** A blank scalar = the user left it empty; we must not transmit it. */
function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === false || (typeof v === 'string' && v.trim() === '');
}

export interface BuildPayloadOptions {
  /** Field names whose value is a number (coerced from the form's string). */
  numbers?: readonly string[];
  /** Field names that are string arrays (e.g. crew[]/services[]). */
  arrays?: readonly string[];
  /** Repeatable object groups; `keep` lists the fields that, if all blank, make
   *  a row "empty" and droppable (e.g. waypoints keep ['name']). */
  objectArrays?: Record<string, { keep: readonly string[] }>;
}

/** Compact a string array: trim each, drop blanks; return undefined if empty. */
function compactStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v): v is string => typeof v === 'string' && v !== '');
  return out.length > 0 ? out : undefined;
}

/** Strip blank fields from one object-array row. */
function compactRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (!isBlank(v)) out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/** Coerce a number-typed form value; returns undefined when blank/unparseable. */
function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isNaN(value) ? undefined : value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

export function buildPayload(
  state: Record<string, unknown>,
  opts: BuildPayloadOptions = {},
): Record<string, unknown> & { body?: string } {
  const numbers = new Set(opts.numbers ?? []);
  const arrays = new Set(opts.arrays ?? []);
  const objectArrays = opts.objectArrays ?? {};
  const out: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(state)) {
    if (key in objectArrays) {
      const { keep } = objectArrays[key]!;
      const rows = Array.isArray(raw) ? raw : [];
      const compacted = rows
        .map(compactRow)
        // A row counts as present only if at least one "keep" field survived.
        .filter((row) => keep.some((k) => !isBlank(row[k])));
      if (compacted.length > 0) out[key] = compacted;
      continue;
    }

    if (arrays.has(key)) {
      const arr = compactStringArray(raw);
      if (arr) out[key] = arr;
      continue;
    }

    if (numbers.has(key)) {
      const n = coerceNumber(raw);
      if (n !== undefined) out[key] = n;
      continue;
    }

    // Scalar (string / body): omit blanks, trim strings.
    if (isBlank(raw)) continue;
    out[key] = typeof raw === 'string' ? raw.trim() : raw;
  }

  return out;
}
