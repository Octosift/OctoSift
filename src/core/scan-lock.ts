/**
 * Makes sure only one scan runs at a time across processes (the worker, the
 * CLI, a second worker started by mistake).
 *
 * The lock is a row in the settings table with an owner and a heartbeat.
 * Acquiring it is an immediate SQLite transaction, so two processes cannot
 * both win. A lock whose heartbeat is older than the stale limit belonged to
 * a process that died and may be taken over.
 */
import type { Db } from './db/client';
import { clearState, readState, writeState } from './state';

export function acquireScanLock(
  db: Db,
  owner: string,
  nowMs: number,
  staleAfterMs: number,
): boolean {
  return db.$client
    .transaction(() => {
      const lock = readState(db, 'state.scanLock');
      const free = lock === null || lock.owner === owner || lock.heartbeatAt < nowMs - staleAfterMs;
      if (free) writeState(db, 'state.scanLock', { owner, heartbeatAt: nowMs });
      return free;
    })
    .immediate();
}

/** Refreshes the heartbeat; returns false if the lock was lost to another process. */
export function heartbeatScanLock(db: Db, owner: string, nowMs: number): boolean {
  return db.$client
    .transaction(() => {
      const lock = readState(db, 'state.scanLock');
      if (lock?.owner !== owner) return false;
      writeState(db, 'state.scanLock', { owner, heartbeatAt: nowMs });
      return true;
    })
    .immediate();
}

export function releaseScanLock(db: Db, owner: string): void {
  db.$client
    .transaction(() => {
      if (readState(db, 'state.scanLock')?.owner === owner) clearState(db, 'state.scanLock');
    })
    .immediate();
}

/** Whether a live scan is running anywhere. */
export function scanInProgress(db: Db, nowMs: number, staleAfterMs: number): boolean {
  const lock = readState(db, 'state.scanLock');
  return lock !== null && lock.heartbeatAt >= nowMs - staleAfterMs;
}

/** Asks the worker for a scan as soon as possible ("Scan now"). */
export function requestScan(db: Db, productId: string | null, nowS: number): void {
  writeState(db, 'state.scanRequest', { requestedAt: nowS, productId });
}

export function pendingScanRequest(
  db: Db,
): { requestedAt: number; productId: string | null } | null {
  return readState(db, 'state.scanRequest');
}

/** Reads and clears a pending request in one step, so it is served once. */
export function takeScanRequest(db: Db): { requestedAt: number; productId: string | null } | null {
  return db.$client
    .transaction(() => {
      const request = readState(db, 'state.scanRequest');
      if (request) clearState(db, 'state.scanRequest');
      return request;
    })
    .immediate();
}
