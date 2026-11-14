/** Scan history. */
import { and, count, desc, eq, gte, isNotNull } from 'drizzle-orm';
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
    apiEquivalentUsd?: number | null;
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
      apiEquivalentUsd: result.apiEquivalentUsd ?? null,
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

export interface SubscriptionReport {
  scans: number;
  postsRead: number;
  /** Days the report covers: from the first such scan in the window to now, one to seven. */
  days: number;
  totalUsd: number;
  perScanUsd: number;
  perPostUsd: number | null;
  perDayUsd: number;
}

/**
 * The API equivalent of scans billed to a subscription over the last seven
 * days, per scan, per post read and per day; null when there were none.
 */
export function subscriptionReport(db: Db, now: number): SubscriptionReport | null {
  const rows = db
    .select({ startedAt: runs.startedAt, api: runs.apiEquivalentUsd, counts: runs.countsJson })
    .from(runs)
    .where(
      and(
        gte(runs.startedAt, now - 7 * 86_400),
        isNotNull(runs.apiEquivalentUsd),
        eq(runs.dryRun, false),
      ),
    )
    .all();
  if (rows.length === 0) return null;
  const totalUsd = rows.reduce((total, row) => total + (row.api ?? 0), 0);
  const postsRead = rows.reduce((total, row) => {
    const fetched =
      typeof row.counts === 'object' && row.counts !== null && 'fetched' in row.counts
        ? Number(row.counts.fetched)
        : 0;
    return total + (Number.isFinite(fetched) ? fetched : 0);
  }, 0);
  const first = Math.min(...rows.map((row) => row.startedAt));
  const days = Math.min(7, Math.max(1, (now - first) / 86_400));
  return {
    scans: rows.length,
    postsRead,
    days,
    totalUsd,
    perScanUsd: totalUsd / rows.length,
    perPostUsd: postsRead > 0 ? totalUsd / postsRead : null,
    perDayUsd: totalUsd / days,
  };
}
