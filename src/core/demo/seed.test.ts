import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { countByTab } from '../db/queries/inbox';
import { recentRuns } from '../db/queries/runs';
import { feedback, usage } from '../db/schema';
import { seedDemo } from './seed';

describe('seedDemo', () => {
  it('fills every inbox tab and leaves a few days of scan history', async () => {
    const db = openMemoryDatabase();
    const summary = await seedDemo(db, Date.parse('2026-11-13T12:00:00Z'));
    const tabs = countByTab(db);
    expect(summary.leads).toBeGreaterThanOrEqual(38);
    expect(tabs).toMatchObject({ replied: 8, snoozed: 2, dismissed: 3, brand: 2 });
    expect(tabs.new).toBeGreaterThan(0);
    expect(tabs.drafted).toBeGreaterThan(0);
    expect(recentRuns(db, 10).map((run) => run.status)).toEqual(['ok', 'ok', 'partial', 'ok']);
    expect(db.select().from(feedback).all()).toHaveLength(4);
    expect(
      db
        .select()
        .from(usage)
        .all()
        .every((row) => row.costUsd !== null),
    ).toBe(true);
  });
});
