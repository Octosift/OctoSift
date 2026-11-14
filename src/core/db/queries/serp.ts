/** Evergreen threads: checks of the buyer keywords and the Reddit threads that ranked. */
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../client';
import { serpRuns, serpThreads, type SerpRunStatus, type SerpRunTrigger } from '../schema';

export type SerpRunRow = typeof serpRuns.$inferSelect;
export type SerpThreadRow = typeof serpThreads.$inferSelect;

export function createSerpRun(
  db: Db,
  input: { id: string; productId: string; trigger: SerpRunTrigger; keywords: number; now: number },
): void {
  db.insert(serpRuns)
    .values({
      id: input.id,
      productId: input.productId,
      trigger: input.trigger,
      status: 'running',
      startedAt: input.now,
      keywords: input.keywords,
    })
    .run();
}

export function finishSerpRun(
  db: Db,
  id: string,
  result: {
    status: Exclude<SerpRunStatus, 'running'>;
    threads: number;
    costUsd: number;
    error: string | null;
    now: number;
  },
): void {
  db.update(serpRuns)
    .set({
      status: result.status,
      threads: result.threads,
      costUsd: result.costUsd,
      error: result.error,
      finishedAt: result.now,
    })
    .where(eq(serpRuns.id, id))
    .run();
}

/** A run of this product still in progress, ignoring ones abandoned long ago. */
export function runningSerpRun(
  db: Db,
  productId: string,
  now: number,
  staleAfterS: number,
): SerpRunRow | null {
  return (
    db
      .select()
      .from(serpRuns)
      .where(
        and(
          eq(serpRuns.productId, productId),
          eq(serpRuns.status, 'running'),
          gte(serpRuns.startedAt, now - staleAfterS),
        ),
      )
      .get() ?? null
  );
}

export function recentSerpRuns(db: Db, productId: string, limit: number): SerpRunRow[] {
  return db
    .select()
    .from(serpRuns)
    .where(eq(serpRuns.productId, productId))
    .orderBy(desc(serpRuns.startedAt))
    .limit(limit)
    .all();
}

/** The newest run that produced results, fully or in part. */
export function lastCompletedSerpRun(db: Db, productId: string): SerpRunRow | null {
  return (
    db
      .select()
      .from(serpRuns)
      .where(and(eq(serpRuns.productId, productId), inArray(serpRuns.status, ['ok', 'partial'])))
      .orderBy(desc(serpRuns.startedAt))
      .limit(1)
      .get() ?? null
  );
}

export function upsertSerpThread(db: Db, row: typeof serpThreads.$inferInsert): void {
  db.insert(serpThreads)
    .values(row)
    .onConflictDoUpdate({
      target: [serpThreads.productId, serpThreads.keyword, serpThreads.url],
      set: {
        rank: row.rank,
        title: row.title,
        subreddit: row.subreddit,
        postId: row.postId,
        publishedAt: row.publishedAt,
        archived: row.archived,
        runId: row.runId,
        checkedAt: row.checkedAt,
      },
    })
    .run();
}

/** Threads found by the given run, by keyword and rank. */
export function threadsForRun(db: Db, runId: string): SerpThreadRow[] {
  return db
    .select()
    .from(serpThreads)
    .where(eq(serpThreads.runId, runId))
    .orderBy(asc(serpThreads.keyword), asc(serpThreads.rank))
    .all();
}
