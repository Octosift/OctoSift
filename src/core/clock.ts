/**
 * Time as a dependency. Core code never reads the system clock directly, so
 * tests can control time and sleeping completes instantly.
 */
import { setTimeout as delay } from 'node:timers/promises';

export interface Clock {
  /** Milliseconds since the epoch. */
  nowMs(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  sleep: async (ms) => {
    if (ms > 0) await delay(ms);
  },
};

export function nowSeconds(clock: Clock): number {
  return Math.floor(clock.nowMs() / 1000);
}

/** A source of randomness in [0, 1); injectable so tests are deterministic. */
export type Random = () => number;

/** Small seeded generator (mulberry32) for reproducible variation. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
