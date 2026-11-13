/** A controllable clock for tests: sleeping advances time instead of waiting. */
import type { Clock } from '../clock';

export interface FakeClock extends Clock {
  advance(ms: number): void;
  sleeps: number[];
}

export function createFakeClock(startMs = Date.parse('2026-11-13T12:00:00Z')): FakeClock {
  let now = startMs;
  const sleeps: number[] = [];
  return {
    nowMs: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += Math.max(0, ms);
      await Promise.resolve();
    },
    advance: (ms) => {
      now += ms;
    },
    sleeps,
  };
}
