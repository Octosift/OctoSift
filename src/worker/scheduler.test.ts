import { describe, expect, it } from 'vitest';
import { acquireScanLock, requestScan } from '../core/scan-lock';
import { requestValidation, validationProgress } from '../core/validation-queue';
import { createScanHarness, type ScanHarness } from '../core/testing/scan-harness';
import { runs } from '../core/db/schema';
import { silentLogger } from '../core/log';
import { createScheduler } from './scheduler';

function setup(options: { beforeBeat?: (harness: ScanHarness) => void } = {}) {
  const harness = createScanHarness('acme-invoices');
  const beats: number[] = [];
  const scheduler = createScheduler({
    db: harness.db,
    settings: harness.settings,
    clock: harness.clock,
    log: silentLogger(),
    scanDeps: () => harness.deps,
    owner: 'worker-test',
    startHeartbeat: (beat) => {
      options.beforeBeat?.(harness);
      beat();
      beats.push(harness.clock.nowMs());
      return () => undefined;
    },
    sleep: (ms) => harness.clock.sleep(ms),
  });
  return { harness, scheduler, beats };
}

describe('scheduler', () => {
  it('scans when subreddits are due and keeps the lock alive meanwhile', async () => {
    const { scheduler, beats } = setup();
    const outcome = await scheduler.tick({ checkSchedule: true });
    expect(outcome.kind).toBe('scanned');
    expect(outcome.kind === 'scanned' && outcome.report.counts.leads).toBe(16);
    expect(beats).toHaveLength(1);
  });

  it('stays idle until the interval has passed', async () => {
    const { scheduler, harness } = setup();
    await scheduler.tick({ checkSchedule: true });
    harness.clock.advance(30 * 60 * 1000);
    expect(await scheduler.tick({ checkSchedule: true })).toEqual({ kind: 'idle' });
    harness.clock.advance(31 * 60 * 1000);
    expect((await scheduler.tick({ checkSchedule: true })).kind).toBe('scanned');
  });

  it('serves a "scan now" request even when nothing is due', async () => {
    const { scheduler, harness } = setup();
    await scheduler.tick({ checkSchedule: true });
    requestScan(harness.db, harness.productId, 0);
    const outcome = await scheduler.tick({ checkSchedule: false });
    expect(outcome.kind === 'scanned' && outcome.report.counts.fetched).toBe(30);
    expect(await scheduler.tick({ checkSchedule: false })).toEqual({ kind: 'idle' });
  });

  it('waits while another process holds the scan lock, keeping the request', async () => {
    const { scheduler, harness } = setup();
    acquireScanLock(harness.db, 'cli-other', harness.clock.nowMs(), 60_000);
    requestScan(harness.db, null, 0);
    expect(await scheduler.tick({ checkSchedule: true })).toEqual({ kind: 'locked' });
    harness.clock.advance(5 * 60 * 1000 + 1);
    expect((await scheduler.tick({ checkSchedule: false })).kind).toBe('scanned');
  });

  it('stops reading when another process takes the scan lock over', async () => {
    const { scheduler } = setup({
      beforeBeat: (harness) => {
        // Another process finds the lock stale and takes it.
        acquireScanLock(harness.db, 'cli-other', harness.clock.nowMs() + 10 * 60_000, 60_000);
      },
    });
    const outcome = await scheduler.tick({ checkSchedule: true });
    expect(outcome.kind === 'scanned' && outcome.report).toMatchObject({
      status: 'partial',
      error: 'Stopped early: another process took over the scan lock.',
      counts: { fetched: 0, leads: 0 },
    });
  });

  it('checks subreddits the dashboard asked about before scanning', async () => {
    const { scheduler, harness, beats } = setup();
    requestValidation(harness.db, ['freelance_demo', 'no_such_demo'], 0);
    expect(await scheduler.tick({ checkSchedule: true })).toEqual({ kind: 'validated' });
    expect(beats).toHaveLength(1);
    expect(validationProgress(harness.db)?.results.map((result) => result.status)).toEqual([
      'ok',
      'gone',
    ]);
    expect((await scheduler.tick({ checkSchedule: true })).kind).toBe('scanned');
  });

  it('keeps checking for work until it is stopped', async () => {
    const harness = createScanHarness('acme-invoices');
    const controller = new AbortController();
    let iterations = 0;
    const scheduler = createScheduler({
      db: harness.db,
      settings: harness.settings,
      clock: harness.clock,
      log: silentLogger(),
      scanDeps: () => harness.deps,
      owner: 'worker-test',
      startHeartbeat: () => () => undefined,
      sleep: (ms) => {
        iterations += 1;
        if (iterations === 3) controller.abort();
        return harness.clock.sleep(ms);
      },
    });
    await scheduler.run(controller.signal);
    expect(iterations).toBe(3);
    expect(harness.db.select().from(runs).all()).toHaveLength(1);
  });

  it('asks for the update check with the scheduled work, and survives its failure', async () => {
    const harness = createScanHarness('acme-invoices');
    const controller = new AbortController();
    let updateChecks = 0;
    let iterations = 0;
    const scheduler = createScheduler({
      db: harness.db,
      settings: harness.settings,
      clock: harness.clock,
      log: silentLogger(),
      scanDeps: () => harness.deps,
      checkUpdates: () => {
        updateChecks += 1;
        return Promise.reject(new Error('GitHub is down'));
      },
      owner: 'worker-test',
      startHeartbeat: () => () => undefined,
      sleep: (ms) => {
        iterations += 1;
        // The schedule is checked once a minute; jump past it each time.
        harness.clock.advance(60_000);
        if (iterations === 2) controller.abort();
        return harness.clock.sleep(ms);
      },
    });
    await scheduler.run(controller.signal);
    expect(updateChecks).toBe(2);
  });

  it('runs the weekly evergreen check when DataForSEO is configured', async () => {
    const harness = createScanHarness('acme-invoices');
    const asked: string[] = [];
    const scheduler = createScheduler({
      db: harness.db,
      settings: harness.settings,
      clock: harness.clock,
      log: silentLogger(),
      scanDeps: () => harness.deps,
      serp: () => (keyword) => {
        asked.push(keyword);
        return Promise.resolve({ ok: true, items: [], costUsd: 0.004 });
      },
      owner: 'worker-test',
    });
    expect(await scheduler.checkEvergreen()).toBe(1);
    expect(asked.length).toBeGreaterThan(0);
    expect(await scheduler.checkEvergreen()).toBe(0);
    harness.clock.advance(7 * 24 * 3600 * 1000);
    expect(await scheduler.checkEvergreen()).toBe(1);
  });

  it('skips the evergreen check while DataForSEO is not configured', async () => {
    const { scheduler } = setup();
    expect(await scheduler.checkEvergreen()).toBe(0);
  });
});
