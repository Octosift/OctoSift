import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { countByTab } from '../db/queries/inbox';
import { recentRuns } from '../db/queries/runs';
import { lastCompletedSerpRun, recentSerpRuns, threadsForRun } from '../db/queries/serp';
import { drafts, feedback, leads, usage } from '../db/schema';
import { seedDemo } from './seed';

describe('seedDemo', () => {
  it('fills every inbox tab and leaves a few days of scan history', async () => {
    const db = openMemoryDatabase();
    const summary = await seedDemo(db, Date.parse('2026-11-13T12:00:00Z'));
    const tabs = countByTab(db);
    expect(summary.leads).toBeGreaterThanOrEqual(38);
    expect(tabs).toMatchObject({ replied: 8, snoozed: 2, dismissed: 3, brand: 2 });
    expect(tabs.todo).toBeGreaterThan(0);
    expect(recentRuns(db, 10).map((run) => run.status)).toEqual(['ok', 'ok', 'partial', 'ok']);
    // Durations a real scan would take, not the zero a frozen clock gives.
    expect(recentRuns(db, 10).map((run) => (run.finishedAt ?? 0) - run.startedAt)).toEqual([
      192, 157, 41, 134,
    ]);
    expect(db.select().from(feedback).all()).toHaveLength(4);
    // Two weekly evergreen checks of the six buyer phrases.
    expect(recentSerpRuns(db, 'demo-acme-invoices', 5).map((run) => run.costUsd)).toEqual([
      0.024, 0.024,
    ]);
    const latest = lastCompletedSerpRun(db, 'demo-acme-invoices');
    const threads = latest ? threadsForRun(db, latest.id) : [];
    expect(threads.length).toBe(13);
    expect(threads.filter((thread) => thread.archived).length).toBe(3);
    // Hand-written content: no two drafts alike, and scores spread out.
    const replies = db
      .select()
      .from(drafts)
      .all()
      .filter((draft) => draft.kind === 'reply');
    expect(replies.length).toBeGreaterThanOrEqual(20);
    expect(new Set(replies.map((draft) => draft.text)).size).toBe(replies.length);
    const scores = db
      .select()
      .from(leads)
      .all()
      .filter((lead) => lead.kind === 'opportunity')
      .map((lead) => lead.score);
    expect(new Set(scores).size).toBeGreaterThanOrEqual(20);
    expect(
      db
        .select()
        .from(usage)
        .all()
        .every((row) => row.costUsd !== null),
    ).toBe(true);
  });
});
