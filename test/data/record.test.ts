import { describe, it, expect } from 'vitest';
import { parseRecord, serializeRecord } from '../../src/data/record.js';

describe('record engine', () => {
  it('parses frontmatter and body', () => {
    const file = ['---', 'id: t-2024-06-22', 'title: Shakedown', '---', '', 'Great sail.'].join('\n');
    const { data, body } = parseRecord(file);
    expect(data).toEqual({ id: 't-2024-06-22', title: 'Shakedown' });
    expect(body).toBe('Great sail.');
  });

  it('round-trips data and body without loss', () => {
    const data = { id: 'm-jib', title: 'Replace halyard', priority: 1, photos: ['photos/a.jpg'] };
    const body = 'Several broken strands.\n\n## Steps\n- [ ] Measure.';
    const reparsed = parseRecord(serializeRecord(data, body));
    expect(reparsed.data).toEqual(data);
    expect(reparsed.body).toBe(body);
  });

  it('handles an empty body', () => {
    const reparsed = parseRecord(serializeRecord({ id: 'c-x', amount: 95 }, ''));
    expect(reparsed.data).toEqual({ id: 'c-x', amount: 95 });
    expect(reparsed.body).toBe('');
  });

  it('keeps a bare ISO date in frontmatter as a string (no Date coercion) and round-trips it', () => {
    const file = ['---', 'id: t-2024-06-22', 'date: 2024-06-22', '---', '', 'Sailed.'].join('\n');
    const { data } = parseRecord(file);
    expect(typeof data.date).toBe('string');
    expect(data.date).toBe('2024-06-22');

    const reparsed = parseRecord(serializeRecord({ id: 't-2024-06-22', date: '2024-06-22' }, 'Sailed.'));
    expect(typeof reparsed.data.date).toBe('string');
    expect(reparsed.data.date).toBe('2024-06-22');
  });
});
