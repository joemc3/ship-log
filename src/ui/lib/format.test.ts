import { describe, it, expect } from 'vitest';
import { fmtMoney, fmtDate, fmtDateShort } from './format.js';

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
