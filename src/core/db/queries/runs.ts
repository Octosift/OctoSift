/** Scan history. */
import { count, desc, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { runs, type RunStatus, type RunTrigger } from '../schema';

export type RunRow = typeof runs.$inferSelect;

export function createRun(
  db: Db,
  input: { id: string; trigger: RunTrigger; dryRun: boolean; now: number; counts: unknown },
): void {
  db.insert(runs)
    .values({
      id: input.id,
      startedAt: input.now,
      trigger: input.trigger,
      status: 'running',
      dryRun: input.dryRun,
      countsJson: input.counts,
    })
    .run();
}

export function finishRun(
  db: Db,
  id: string,
  result: {
    now: number;
    status: RunStatus;
    counts: unknown;
    costUsd: number;
    costIncomplete: boolean;
    error: string | null;
  },
): void {
  db.update(runs)
    .set({
      finishedAt: result.now,
      status: result.status,
      countsJson: result.counts,
      costUsd: result.costUsd,
      costIncomplete: result.costIncomplete,
      error: result.error,
    })
    .where(eq(runs.id, id))
    .run();
}

/** Saves the counts so far, so the dashboard can show a scan's progress. */
export function updateRunCounts(db: Db, id: string, counts: unknown): void {
  db.update(runs).set({ countsJson: counts }).where(eq(runs.id, id)).run();
}

export function getRun(db: Db, id: string): RunRow | null {
  return db.select().from(runs).where(eq(runs.id, id)).get() ?? null;
}

export function recentRuns(db: Db, limit: number, offset = 0): RunRow[] {
  return db.select().from(runs).orderBy(desc(runs.startedAt)).limit(limit).offset(offset).all();
}

export function countRuns(db: Db): number {
  return db.select({ value: count() }).from(runs).get()?.value ?? 0;
}
