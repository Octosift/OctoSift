import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';

function collectObjects(value: unknown, path: string, out: { path: string; value: object }[]) {
  if (typeof value !== 'object' || value === null) return out;
  out.push({ path, value });
  for (const [key, child] of Object.entries(value)) collectObjects(child, `${path}.${key}`, out);
  return out;
}

describe('CONFIG', () => {
  it('is frozen at every level', () => {
    const notFrozen = collectObjects(CONFIG, 'CONFIG', [])
      .filter((entry) => !Object.isFrozen(entry.value))
      .map((entry) => entry.path);
    expect(notFrozen).toEqual([]);
  });

  it('rejects attempts to change a default at runtime', () => {
    expect(() => {
      Object.assign(CONFIG.thresholds, { show: 0 });
    }).toThrow(TypeError);
    expect(CONFIG.thresholds.show).toBe(60);
  });

  it('keeps the draft threshold above the show threshold', () => {
    expect(CONFIG.thresholds.draft).toBeGreaterThan(CONFIG.thresholds.show);
    expect(CONFIG.thresholds.notify).toBeGreaterThan(CONFIG.thresholds.draft);
  });

  it('never lets a scan interval go below the minimum', () => {
    expect(CONFIG.schedule.defaultIntervalMinutes).toBeGreaterThanOrEqual(
      CONFIG.schedule.minIntervalMinutes,
    );
  });
});
