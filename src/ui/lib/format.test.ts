import { describe, it, expect } from 'vitest';
import { fmtMoney, fmtDate, fmtDateShort, fmtTime, fmtRelative } from './format.js';

describe('fmtMoney', () => {
  it('formats with a leading $ and two decimals', () => {
    expect(fmtMoney(1234.5)).toBe('$1,234.50');
    expect(fmtMoney(0)).toBe('$0.00');
  });

  it('drops the currency symbol when withSymbol=false', () => {
    expect(fmtMoney(1234.5, false)).toBe('1,234.50');
  });

  it('renders a placeholder for an absent (redacted) amount', () => {
    expect(fmtMoney(undefined)).toBe('—');
    expect(fmtMoney(null)).toBe('—');
  });
});

describe('fmtDate / fmtDateShort', () => {
  // Parse the ISO parts directly (no UTC shift) so the day never slips a date.
  it('formats a full ISO date as Mon D, YYYY', () => {
    expect(fmtDate('2026-05-09')).toBe('May 9, 2026');
    expect(fmtDate('2024-12-31')).toBe('Dec 31, 2024');
  });

  it('formats a short ISO date as Mon D (no year)', () => {
    expect(fmtDateShort('2026-05-09')).toBe('May 9');
  });

  it('passes through a non-ISO or empty value unchanged', () => {
    expect(fmtDate('')).toBe('');
    expect(fmtDate(undefined)).toBe('');
  });
});

describe('fmtTime', () => {
  it('formats a full ISO timestamp as a clock time', () => {
    const out = fmtTime('2026-06-20T15:12:00Z');
    expect(out).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
  });
  it('returns empty string for empty input', () => {
    expect(fmtTime(undefined)).toBe('');
    expect(fmtTime('')).toBe('');
  });
});

describe('fmtRelative', () => {
  const now = new Date('2026-06-20T18:00:00Z');
  it('reports hours ago', () => {
    expect(fmtRelative('2026-06-20T15:00:00Z', now)).toBe('3h ago');
  });
  it('reports minutes ago', () => {
    expect(fmtRelative('2026-06-20T17:30:00Z', now)).toBe('30m ago');
  });
  it('reports just now within a minute', () => {
    expect(fmtRelative('2026-06-20T18:00:20Z', now)).toBe('just now');
  });
  it('reports future as "in Xh"', () => {
    expect(fmtRelative('2026-06-20T20:00:00Z', now)).toBe('in 2h');
  });
  it('returns empty string for empty/invalid input', () => {
    expect(fmtRelative(undefined, now)).toBe('');
    expect(fmtRelative('not-a-date', now)).toBe('');
  });
});
