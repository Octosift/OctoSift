/** Per-subreddit numbers for the Subreddits screen. */
import { and, count, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { leads, posts, productSubreddits, subreddits } from '../schema';

export interface SubredditStats {
  name: string;
  enabled: boolean;
  status: string;
  lastPolledAt: number | null;
  blockUntil: number | null;
  pollIntervalMinutes: number | null;
  postsPerDay: number | null;
  promotionPolicy: string;
  rulesSummary: unknown;
  rulesText: string | null;
  rulesUpdatedAt: number | null;
  postsSeen: number;
  leads: number;
}

export function subredditStats(db: Db, productId: string): SubredditStats[] {
  const rows = db
    .select({
      name: subreddits.name,
      enabled: productSubreddits.enabled,
      status: subreddits.status,
      lastPolledAt: subreddits.lastPolledAt,
      blockUntil: subreddits.blockUntil,
      pollIntervalMinutes: subreddits.pollIntervalMinutes,
      postsPerDay: subreddits.postsPerDay,
      promotionPolicy: subreddits.promotionPolicy,
      rulesSummary: subreddits.rulesSummaryJson,
      rulesText: subreddits.rulesText,
      rulesUpdatedAt: subreddits.rulesUpdatedAt,
    })
    .from(productSubreddits)
    .innerJoin(subreddits, eq(subreddits.name, productSubreddits.subreddit))
    .where(eq(productSubreddits.productId, productId))
    .orderBy(subreddits.name)
    .all();
  const seen = new Map(
    db
      .select({ name: posts.subreddit, value: count() })
      .from(posts)
      .groupBy(posts.subreddit)
      .all()
      .map((row) => [row.name, row.value]),
  );
  const found = new Map(
    db
      .select({ name: posts.subreddit, value: sql<number>`count(${leads.id})` })
      .from(leads)
      .innerJoin(posts, eq(posts.id, leads.postId))
      .where(and(eq(leads.productId, productId), eq(leads.kind, 'opportunity')))
      .groupBy(posts.subreddit)
      .all()
      .map((row) => [row.name, row.value]),
  );
  return rows.map((row) => ({
    ...row,
    postsSeen: seen.get(row.name) ?? 0,
    leads: found.get(row.name) ?? 0,
  }));
}
