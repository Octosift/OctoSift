import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from './db/client';
import {
  acquireScanLock,
  heartbeatScanLock,
  pendingScanRequest,
  releaseScanLock,
  requestScan,
  scanInProgress,
  takeScanRequest,
} from './scan-lock';

const STALE = 5 * 60 * 1000;

describe('scan lock', () => {
  it('lets one owner hold the lock at a time', () => {
    const db = openMemoryDatabase();
    expect(acquireScanLock(db, 'worker-a', 1_000, STALE)).toBe(true);
    expect(acquireScanLock(db, 'worker-b', 2_000, STALE)).toBe(false);
    expect(acquireScanLock(db, 'worker-a', 3_000, STALE)).toBe(true);
  });

  it('hands the lock over once the holder is released', () => {
    const db = openMemoryDatabase();
    acquireScanLock(db, 'worker-a', 1_000, STALE);
    releaseScanLock(db, 'worker-a');
    expect(acquireScanLock(db, 'worker-b', 2_000, STALE)).toBe(true);
  });

  it('ignores a release from a process that does not hold the lock', () => {
    const db = openMemoryDatabase();
    acquireScanLock(db, 'worker-a', 1_000, STALE);
    releaseScanLock(db, 'worker-b');
    expect(acquireScanLock(db, 'worker-b', 2_000, STALE)).toBe(false);
  });

  it('lets another process take over a lock whose heartbeat stopped', () => {
    const db = openMemoryDatabase();
    acquireScanLock(db, 'worker-a', 1_000, STALE);
    expect(acquireScanLock(db, 'worker-b', 1_000 + STALE + 1, STALE)).toBe(true);
    expect(heartbeatScanLock(db, 'worker-a', 1_000 + STALE + 2)).toBe(false);
  });

  it('keeps a lock alive with heartbeats', () => {
    const db = openMemoryDatabase();
    acquireScanLock(db, 'worker-a', 1_000, STALE);
    expect(heartbeatScanLock(db, 'worker-a', 1_000 + STALE)).toBe(true);
    expect(acquireScanLock(db, 'worker-b', 1_000 + STALE + 1, STALE)).toBe(false);
    expect(scanInProgress(db, 1_000 + STALE + 1, STALE)).toBe(true);
  });
});

describe('scan requests', () => {
  it('serves a request exactly once', () => {
    const db = openMemoryDatabase();
    requestScan(db, 'product-1', 100);
    expect(pendingScanRequest(db)).toEqual({ requestedAt: 100, productId: 'product-1' });
    expect(takeScanRequest(db)).toEqual({ requestedAt: 100, productId: 'product-1' });
    expect(takeScanRequest(db)).toBeNull();
  });
});
