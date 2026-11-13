/**
 * One limiter for every Reddit request in the process.
 *
 * Requests run strictly one at a time with a minimum spacing plus random
 * jitter. Reddit's rate-limit headers override the spacing: when the budget
 * for the current window is used up, the next request waits for the reset.
 * A pause (after a block) makes requests return immediately with the time
 * reads resume, so a scan can finish instead of sleeping for minutes.
 */
import type { Clock, Random } from '../clock';
import type { RateInfo } from './types';

export type LimitedResult<T> = { status: 'ran'; value: T } | { status: 'paused'; untilMs: number };

export interface RateLimiter {
  run<T>(task: () => Promise<T>): Promise<LimitedResult<T>>;
  /** Feeds the rate-limit headers of a response back into the schedule. */
  observe(rate: RateInfo): void;
  /** Stops all reads until the given time. Never shortens an existing pause. */
  pause(untilMs: number): void;
  pausedUntil(): number | null;
}

export interface RateLimiterOptions {
  clock: Clock;
  random: Random;
  minSpacingMs: number;
  maxJitterMs: number;
  /** Waits longer than this are reported as a pause instead of slept through. */
  maxWaitMs: number;
}

/** Small margin after a reported reset, so the next request lands in the new window. */
const RESET_MARGIN_MS = 1_000;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { clock, random, minSpacingMs, maxJitterMs, maxWaitMs } = options;
  let nextAllowedAt = 0;
  let pausedUntilMs = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const jitter = () => Math.floor(random() * maxJitterMs);

  async function takeTurn<T>(task: () => Promise<T>): Promise<LimitedResult<T>> {
    const now = clock.nowMs();
    if (pausedUntilMs > now) return { status: 'paused', untilMs: pausedUntilMs };
    const wait = nextAllowedAt - now;
    if (wait > maxWaitMs) return { status: 'paused', untilMs: nextAllowedAt };
    if (wait > 0) await clock.sleep(wait);
    nextAllowedAt = clock.nowMs() + minSpacingMs + jitter();
    return { status: 'ran', value: await task() };
  }

  return {
    run(task) {
      const turn = queue.then(() => takeTurn(task));
      // The queue only orders requests; a failed task must not block the next one.
      queue = turn.catch(() => undefined);
      return turn;
    },

    observe(rate) {
      if (rate.remaining === null || rate.remaining >= 1 || rate.resetS === null) return;
      const resetAt = clock.nowMs() + rate.resetS * 1000 + RESET_MARGIN_MS + jitter();
      nextAllowedAt = Math.max(nextAllowedAt, resetAt);
    },

    pause(untilMs) {
      pausedUntilMs = Math.max(pausedUntilMs, untilMs);
    },

    pausedUntil() {
      return pausedUntilMs > clock.nowMs() ? pausedUntilMs : null;
    },
  };
}
