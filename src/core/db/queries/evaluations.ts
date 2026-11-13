/** The per-stage verdicts that drive deduplication and the funnel. */
import { and, eq, inArray } from 'drizzle-orm';
import type { StageRecord } from '../../pipeline/dedup';
import type { Db } from '../client';
import { evaluations, posts, type EvaluationStage } from '../schema';

export type EvaluationRow = typeof evaluations.$inferInsert;

/** One row per product, post and stage; a retry replaces the earlier row. */
export function saveEvaluation(db: Db, row: EvaluationRow): void {
  db.insert(evaluations)
    .values(row)
    .onConflictDoUpdate({
      target: [evaluations.productId, evaluations.postId, evaluations.stage],
      set: {
        verdict: row.verdict,
        reason: row.reason,
        dataJson: row.dataJson ?? null,
        model: row.model ?? null,
        runId: row.runId ?? null,
        createdAt: row.createdAt,
      },
    })
    .run();
}

export function stageRecords(
  db: Db,
  productId: string,
  postIds: string[],
): Map<string, StageRecord[]> {
  const records = new Map<string, StageRecord[]>();
  if (postIds.length === 0) return records;
  const rows = db
    .select({
      postId: evaluations.postId,
      stage: evaluations.stage,
      verdict: evaluations.verdict,
      reason: evaluations.reason,
    })
    .from(evaluations)
    .where(and(eq(evaluations.productId, productId), inArray(evaluations.postId, postIds)))
    .all();
  for (const row of rows) {
    const list = records.get(row.postId) ?? [];
    list.push({ stage: row.stage, verdict: row.verdict, reason: row.reason });
    records.set(row.postId, list);
  }
  return records;
}

export interface StageEntry {
  postId: string;
  productId: string;
  verdict: string;
  reason: string;
  model: string | null;
  title: string;
  subreddit: string;
  url: string;
}

/** Posts and reasons at one stage of one run, for the funnel drill-down. */
export function evaluationsForRun(db: Db, runId: string, stage: EvaluationStage): StageEntry[] {
  return db
    .select({
      postId: evaluations.postId,
      productId: evaluations.productId,
      verdict: evaluations.verdict,
      reason: evaluations.reason,
      model: evaluations.model,
      title: posts.title,
      subreddit: posts.subreddit,
      url: posts.url,
    })
    .from(evaluations)
    .innerJoin(posts, eq(posts.id, evaluations.postId))
    .where(and(eq(evaluations.runId, runId), eq(evaluations.stage, stage)))
    .all();
}
