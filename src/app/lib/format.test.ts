import { describe, expect, it } from 'vitest';
import { formatAge, formatAgo, formatUsd, plural } from './format';

describe('formatAge', () => {
  it.each([
    [10, 'now'],
    [5 * 60, '5m'],
    [3 * 3600, '3h'],
    [47 * 3600, '47h'],
    [3 * 86400, '3d'],
    [20 * 86400, '2w'],
    [400 * 86400, '1y'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatAge(seconds)).toBe(expected);
  });
});

describe('formatAgo', () => {
  it('says "just now" for very recent times', () => {
    expect(formatAgo(1000, 1010)).toBe('just now');
    expect(formatAgo(1000, 1000 + 7200)).toBe('2h ago');
  });
});

describe('formatUsd', () => {
  it('shows small amounts with more precision and marks incomplete totals', () => {
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(0, true)).toBe('$0.00+');
  });
});

describe('plural', () => {
  it('picks the right form', () => {
    expect(plural(1, 'lead')).toBe('1 lead');
    expect(plural(3, 'lead')).toBe('3 leads');
  });
});
