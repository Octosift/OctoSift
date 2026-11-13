/**
 * The worker's loop. Every few seconds it looks for a "scan now" request;
 * once a minute it checks whether any watched subreddit is due. When there
 * is work it takes the scan lock, runs one scan covering everything due,
 * and keeps the lock alive with heartbeats until the scan finishes.
 */
import { nowSeconds, type Clock } from '../core/clock';
import { CONFIG } from '../core/config';
import type { Db } from '../core/db/client';
import { enabledSubredditNames } from '../core/db/queries/products';
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
import type { SettingsStore } from '../core/settings/store';

export interface SchedulerDeps {
  db: Db;
  settings: SettingsStore;
  clock: Clock;
  log: Logger;
  scanDeps: () => ScanDeps;
  /** Identifies this process in the scan lock. */
  owner: string;
  /** Calls `beat` periodically until the returned function is called. */
  startHeartbeat?: (beat: () => void) => () => void;
  /** Waits between iterations; resolves early when the signal aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export type TickOutcome =
  { kind: 'idle' } | { kind: 'locked' } | { kind: 'scanned'; report: ScanReport };

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

  async function tick(options: { checkSchedule: boolean }): Promise<TickOutcome> {
    const requested = pendingScanRequest(db) !== null;
    const due = requested || (options.checkSchedule && hasDueWork(db, settings, nowSeconds(clock)));
    if (!due) return { kind: 'idle' };
    if (!acquireScanLock(db, owner, clock.nowMs(), CONFIG.schedule.lockStaleAfterMs)) {
      return { kind: 'locked' };
    }
    const request = takeScanRequest(db);
    const stopHeartbeat = startHeartbeat(() => {
      if (!heartbeatScanLock(db, owner, clock.nowMs()))
        log.warn('Scan lock lost to another process');
    });
    try {
      const report = await runScan(deps.scanDeps(), {
        trigger: request ? 'manual' : 'schedule',
        ignoreSchedule: request !== null,
        ...(request?.productId ? { productId: request.productId } : {}),
      });
      return { kind: 'scanned', report };
    } finally {
      stopHeartbeat();
      releaseScanLock(db, owner);
    }
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
      } catch (error) {
        log.error('Worker iteration failed', { error });
      }
      await sleep(CONFIG.schedule.scanRequestPollMs, signal);
    }
    log.info('Worker stopped', { owner });
  }

  return { tick, run };
}
