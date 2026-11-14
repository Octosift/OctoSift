import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from './db/client';
import {
  createWorkerStatus,
  IDLE,
  readWorkerStatus,
  subredditList,
  WORKER_STALE_MS,
} from './worker-status';

describe('worker status', () => {
  it('reports the latest activity while the heartbeat is fresh, and nothing once it is stale', () => {
    const db = openMemoryDatabase();
    let now = 1_000_000;
    const status = createWorkerStatus(db, 'worker-1', () => now);
    expect(readWorkerStatus(db, now)).toBeNull();
    status.set({
      activity: 'reading',
      detail: subredditList(['a_demo', 'b_demo']),
      done: 1,
      total: 4,
    });
    expect(readWorkerStatus(db, now)).toMatchObject({
      owner: 'worker-1',
      activity: 'reading',
      detail: 'r/a_demo, r/b_demo',
      done: 1,
      total: 4,
    });
    now += WORKER_STALE_MS + 1;
    expect(readWorkerStatus(db, now)).toBeNull();
    status.beat();
    expect(readWorkerStatus(db, now)).toMatchObject({ activity: 'reading' });
    status.set(IDLE);
    expect(readWorkerStatus(db, now)?.activity).toBe('idle');
  });
});
