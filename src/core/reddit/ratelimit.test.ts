import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../testing/fake-clock';
import { createRateLimiter } from './ratelimit';

function gap(starts: number[]): number {
  const [first, second] = starts;
  if (first === undefined || second === undefined) throw new Error('expected two requests');
  return second - first;
}

function setup(random = () => 0.5) {
  const clock = createFakeClock(1_000_000);
  const starts: number[] = [];
  const limiter = createRateLimiter({
    clock,
    random,
    minSpacingMs: 10_000,
    maxJitterMs: 3_000,
    maxWaitMs: 120_000,
  });
  const request = (value = 'ok') =>
    limiter.run(() => {
      starts.push(clock.nowMs());
      return Promise.resolve(value);
    });
  return { clock, limiter, starts, request };
}

describe('rate limiter', () => {
  it('runs the first request immediately', async () => {
    const { request, starts } = setup();
    expect(await request()).toEqual({ status: 'ran', value: 'ok' });
    expect(starts).toEqual([1_000_000]);
  });

  it('spaces requests by the minimum interval plus jitter', async () => {
    const { request, starts } = setup(() => 0.5);
    await request();
    await request();
    expect(gap(starts)).toBe(11_500);
  });

  it('uses no jitter when the random source returns zero', async () => {
    const { request, starts } = setup(() => 0);
    await request();
    await request();
    expect(gap(starts)).toBe(10_000);
  });

  it('runs one request at a time', async () => {
    const { limiter, clock } = setup();
    const events: string[] = [];
    const slow = limiter.run(async () => {
      events.push('first:start');
      await clock.sleep(5_000);
      events.push('first:end');
    });
    const fast = limiter.run(() => {
      events.push('second:start');
      return Promise.resolve();
    });
    await Promise.all([slow, fast]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('waits for the reset time when the remaining budget is used up', async () => {
    const { limiter, request, starts } = setup(() => 0);
    await request();
    limiter.observe({ used: 1, remaining: 0, resetS: 54 });
    await request();
    expect(gap(starts)).toBeGreaterThanOrEqual(54_000);
  });

  it('keeps the normal spacing while budget remains', async () => {
    const { limiter, request, starts } = setup(() => 0);
    await request();
    limiter.observe({ used: 10, remaining: 50, resetS: 300 });
    await request();
    expect(gap(starts)).toBe(10_000);
  });

  it('does not run requests while paused and reports when reads resume', async () => {
    const { limiter, request, starts, clock } = setup();
    limiter.pause(clock.nowMs() + 600_000);
    expect(await request()).toEqual({ status: 'paused', untilMs: 1_600_000 });
    expect(starts).toEqual([]);
    clock.advance(600_000);
    expect((await request()).status).toBe('ran');
  });

  it('never shortens an existing pause', () => {
    const { limiter, clock } = setup();
    limiter.pause(clock.nowMs() + 600_000);
    limiter.pause(clock.nowMs() + 60_000);
    expect(limiter.pausedUntil()).toBe(1_600_000);
  });

  it('gives up instead of waiting longer than the maximum wait', async () => {
    const { limiter, request, starts } = setup(() => 0);
    await request();
    limiter.observe({ used: 1, remaining: 0, resetS: 900 });
    const result = await request();
    expect(result.status).toBe('paused');
    expect(starts).toHaveLength(1);
  });

  it('keeps serving requests after a task fails', async () => {
    const { limiter, request } = setup();
    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect((await request()).status).toBe('ran');
  });

  it('reports a pause once the hourly cap is reached, until the oldest request ages out', async () => {
    const clock = createFakeClock();
    const limiter = createRateLimiter({
      clock,
      random: () => 0,
      minSpacingMs: 1_000,
      maxJitterMs: 0,
      maxWaitMs: 60_000,
      maxPerHour: 3,
    });
    const start = clock.nowMs();
    for (let index = 0; index < 3; index += 1) {
      expect((await limiter.run(() => Promise.resolve(index))).status).toBe('ran');
    }
    expect(await limiter.run(() => Promise.resolve(3))).toEqual({
      status: 'paused',
      untilMs: start + 3_600_000,
    });
    clock.advance(3_600_000);
    expect((await limiter.run(() => Promise.resolve(4))).status).toBe('ran');
  });
});
