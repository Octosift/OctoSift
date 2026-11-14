/**
 * The worker's loop. Every few seconds it looks for a "scan now" request;
 * once a minute it checks whether any watched subreddit is due. When there
 * is work it takes the scan lock, runs one scan covering everything due,
 * and keeps the lock alive with heartbeats until the scan finishes.
 *
 * Once a minute it also runs the weekly evergreen check for any product that
 * is due, when DataForSEO is configured. That reads Google results, not
 * Reddit, so it does not take the scan lock.
 */
import { nowSeconds, type Clock } from '../core/clock';
import { CONFIG } from '../core/config';
import type { Db } from '../core/db/client';
import { enabledSubredditNames, listProducts } from '../core/db/queries/products';
import { pollStates } from '../core/db/queries/subreddits';
import type { Logger } from '../core/log';
import { runScan, type ScanDeps, type ScanReport } from '../core/pipeline/run';
import { dueSubreddits } from '../core/reddit/polling';
import {
  acquireScanLock,
  heartbeatScanLock,
  pendingScanRequest,
  releaseScanLock,
  takeScanRequest,
} from '../core/scan-lock';
import type { SerpFetcher } from '../core/serp/dataforseo';
import { evergreenDue, runEvergreenForProduct } from '../core/serp/evergreen';
import type { SettingsStore } from '../core/settings/store';
import { hasValidationRequest, runValidationRequest } from '../core/validation-queue';

export interface SchedulerDeps {
  db: Db;
  settings: SettingsStore;
  clock: Clock;
  log: Logger;
  scanDeps: () => ScanDeps;
  /** The DataForSEO fetcher, or null while it is not configured. */
  serp?: () => SerpFetcher | null;
  /** Runs the reply visibility checks that are due. */
  checkReplies?: () => Promise<number>;
  /** Identifies this process in the scan lock. */
  owner: string;
  /** Calls `beat` periodically until the returned function is called. */
  startHeartbeat?: (beat: () => void) => () => void;
  /** Waits between iterations; resolves early when the signal aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export type TickOutcome =
  | { kind: 'idle' }
  | { kind: 'locked' }
  | { kind: 'validated' }
  | { kind: 'scanned'; report: ScanReport };

function intervalHeartbeat(beat: () => void): () => void {
  const timer = setInterval(beat, CONFIG.schedule.lockHeartbeatMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Whether any watched subreddit is due for a read. */
export function hasDueWork(db: Db, settings: SettingsStore, nowS: number): boolean {
  const states = pollStates(db, enabledSubredditNames(db));
  return (
    dueSubreddits(states, {
      now: nowS,
      defaultIntervalMinutes: settings.get('schedule.intervalMinutes'),
    }).length > 0
  );
}

export function createScheduler(deps: SchedulerDeps) {
  const { db, settings, clock, log, owner } = deps;
  const startHeartbeat = deps.startHeartbeat ?? intervalHeartbeat;
  const sleep = deps.sleep ?? abortableSleep;

  /**
   * Holds the scan lock while `work` runs and keeps its heartbeat going. The
   * signal is aborted if another process takes the lock over.
   */
  async function withLock(
    work: (signal: AbortSignal) => Promise<TickOutcome>,
  ): Promise<TickOutcome> {
    if (!acquireScanLock(db, owner, clock.nowMs(), CONFIG.schedule.lockStaleAfterMs)) {
      return { kind: 'locked' };
    }
    const lost = new AbortController();
    const stopHeartbeat = startHeartbeat(() => {
      if (lost.signal.aborted || heartbeatScanLock(db, owner, clock.nowMs())) return;
      log.warn('Scan lock lost to another process; stopping');
      lost.abort(new Error('Stopped early: another process took over the scan lock.'));
    });
    try {
      return await work(lost.signal);
    } finally {
      stopHeartbeat();
      releaseScanLock(db, owner);
    }
  }

  /** Subreddit checks requested by the dashboard read Reddit too, so they share the lock. */
  function validate(): Promise<TickOutcome> {
    return withLock(async () => {
      await runValidationRequest(db, deps.scanDeps().source, nowSeconds(clock));
      return { kind: 'validated' };
    });
  }

  async function tick(options: { checkSchedule: boolean }): Promise<TickOutcome> {
    if (hasValidationRequest(db)) return validate();
    const requested = pendingScanRequest(db) !== null;
    const due = requested || (options.checkSchedule && hasDueWork(db, settings, nowSeconds(clock)));
    if (!due) return { kind: 'idle' };
    return withLock(async (signal) => {
      const request = takeScanRequest(db);
      const report = await runScan(deps.scanDeps(), {
        trigger: request ? 'manual' : 'schedule',
        ignoreSchedule: request !== null,
        signal,
        ...(request?.productId ? { productId: request.productId } : {}),
      });
      return { kind: 'scanned', report };
    });
  }

  /** Runs the weekly evergreen check for every product that is due; returns how many ran. */
  async function checkEvergreen(): Promise<number> {
    const fetchSerp = deps.serp?.() ?? null;
    if (!fetchSerp) return 0;
    let ran = 0;
    for (const product of listProducts(db)) {
      const now = nowSeconds(clock);
      if (!product.profile || !evergreenDue(db, product.id, now)) continue;
      const result = await runEvergreenForProduct(
        { db, fetchSerp, log, now, settings },
        product,
        'schedule',
      );
      if (result.ok) ran += 1;
      else log.warn('Evergreen check skipped', { productId: product.id, reason: result.message });
    }
    return ran;
  }

  async function run(signal: AbortSignal): Promise<void> {
    let lastScheduleCheck = Number.NEGATIVE_INFINITY;
    log.info('Worker started', { owner });
    while (!signal.aborted) {
      const now = clock.nowMs();
      const checkSchedule = now - lastScheduleCheck >= CONFIG.schedule.workerTickMs;
      if (checkSchedule) lastScheduleCheck = now;
      try {
        const outcome = await tick({ checkSchedule });
        if (outcome.kind === 'locked') log.debug('Another process is scanning; waiting');
        if (checkSchedule) {
          await checkEvergreen();
          await deps.checkReplies?.();
        }
      } catch (error) {
        log.error('Worker iteration failed', { error });
      }
      await sleep(CONFIG.schedule.scanRequestPollMs, signal);
    }
    log.info('Worker stopped', { owner });
  }

  return { tick, run, checkEvergreen };
}
