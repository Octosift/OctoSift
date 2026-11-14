import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../client';
import { createRun, finishRun, subscriptionReport } from './runs';

const NOW = 1_800_000_000;
const DAY = 86_400;

function addRun(
  db: ReturnType<typeof openMemoryDatabase>,
  id: string,
  startedAt: number,
  fetched: number,
  apiEquivalentUsd: number | null,
  dryRun = false,
) {
  createRun(db, { id, trigger: 'schedule', dryRun, now: startedAt, counts: {} });
  finishRun(db, id, {
    now: startedAt + 60,
    status: 'ok',
    counts: { fetched },
    costUsd: 0,
    apiEquivalentUsd,
    costIncomplete: false,
    error: null,
  });
}

describe('subscription report', () => {
  it('is empty without scans billed to a subscription', () => {
    const db = openMemoryDatabase();
    addRun(db, 'api', NOW - DAY, 40, null);
    expect(subscriptionReport(db, NOW)).toBeNull();
  });

  it('averages the API equivalent per scan, per post read and per day over seven days', () => {
    const db = openMemoryDatabase();
    addRun(db, 'r1', NOW - 2 * DAY, 30, 0.3);
    addRun(db, 'r2', NOW - DAY, 50, 0.5);
    addRun(db, 'old', NOW - 8 * DAY, 100, 9);
    addRun(db, 'dry', NOW - DAY, 100, 9, true);
    addRun(db, 'api', NOW - DAY, 100, null);
    const report = subscriptionReport(db, NOW);
    expect(report).toMatchObject({ scans: 2, postsRead: 80, days: 2 });
    expect(report?.totalUsd).toBeCloseTo(0.8);
    expect(report?.perScanUsd).toBeCloseTo(0.4);
    expect(report?.perPostUsd).toBeCloseTo(0.01);
    expect(report?.perDayUsd).toBeCloseTo(0.4);
  });

  it('counts at least one day for a report that just started', () => {
    const db = openMemoryDatabase();
    addRun(db, 'r1', NOW - 600, 0, 0.2);
    expect(subscriptionReport(db, NOW)).toMatchObject({ days: 1, perPostUsd: null });
  });
});
