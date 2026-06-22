/**
 * Display formatters ported from the prototype's helpers (components.jsx).
 * Dates are parsed from their ISO parts into a *local* Date so the rendered day
 * never slips across a timezone boundary (the records store bare YYYY-MM-DD
 * calendar dates, not instants).
 */

/** `$1,234.50`. `withSymbol=false` drops the leading `$`. An absent amount
 *  (a redacted/owner-only cost the server stripped) renders an em-dash, so the
 *  UI degrades gracefully for crew/guest instead of printing `$NaN`. */
export function fmtMoney(n: number | null | undefined, withSymbol = true): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const body = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withSymbol ? `$${body}` : body;
}

function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** `May 9, 2026`. Non-ISO / empty input passes through unchanged. */
export function fmtDate(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return iso ?? '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** `May 9` (no year). Non-ISO / empty input passes through unchanged. */
export function fmtDateShort(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return iso ?? '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** `3:12 PM` from a full ISO timestamp (rendered in local time). Empty input
 *  returns ''; an unparseable string passes through unchanged. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** `3h ago` / `30m ago` / `just now` / `in 2h` relative to `now`. Empty or
 *  unparseable input returns ''. Used for the "updated …" line on Conditions. */
export function fmtRelative(iso: string | null | undefined, now: Date): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diffMin = Math.round((now.getTime() - t) / 60_000);
  if (Math.abs(diffMin) < 1) return 'just now';
  const m = Math.abs(diffMin);
  const txt = m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  return diffMin > 0 ? `${txt} ago` : `in ${txt}`;
}
