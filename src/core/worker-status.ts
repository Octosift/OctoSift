/**
 * The worker's own report of what it is doing, written to the shared state
 * with a heartbeat. The dashboard reads it to say "reading r/x, 2 of 5" or
 * "checking subreddits" instead of guessing, and to tell a busy worker from
 * one that is not running at all.
 */
import type { Db } from './db/client';
import { readState, writeState, type StateValue } from './state';

export type WorkerState = StateValue<'state.worker'>;
export type WorkerActivity = Pick<WorkerState, 'activity' | 'detail' | 'done' | 'total'>;

/** A heartbeat older than this means the worker is not running. */
export const WORKER_STALE_MS = 20_000;

export const IDLE: WorkerActivity = { activity: 'idle', detail: null, done: null, total: null };

export function createWorkerStatus(db: Db, owner: string, nowMs: () => number) {
  let current: WorkerActivity = IDLE;
  const write = () => {
    writeState(db, 'state.worker', { owner, heartbeatAt: nowMs(), ...current });
  };
  return {
    beat: write,
    set(next: WorkerActivity) {
      current = next;
      write();
    },
  };
}

/** The worker's last report, or null when it has not reported recently. */
export function readWorkerStatus(db: Db, nowMs: number): WorkerState | null {
  const state = readState(db, 'state.worker');
  return state && nowMs - state.heartbeatAt <= WORKER_STALE_MS ? state : null;
}

/** "r/a, r/b" for a short list of subreddits. */
export function subredditList(names: readonly string[]): string {
  return names.map((name) => `r/${name}`).join(', ');
}
