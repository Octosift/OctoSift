/** Shared subreddit state: polling schedule, blocks and rules. */
import { eq, inArray } from 'drizzle-orm';
import { rulesSummaryWire, type RulesSummary } from '../../ai/schemas';
import type { SubredditPollState } from '../../reddit/polling';
import type { Db } from '../client';
import { posts, subreddits, type PromotionPolicy, type SubredditStatus } from '../schema';

export type SubredditRow = typeof subreddits.$inferSelect;

export function getSubreddits(db: Db, names: string[]): SubredditRow[] {
  if (names.length === 0) return [];
  return db.select().from(subreddits).where(inArray(subreddits.name, names)).all();
}

export function getSubreddit(db: Db, name: string): SubredditRow | null {
  return db.select().from(subreddits).where(eq(subreddits.name, name)).get() ?? null;
}

export function listSubreddits(db: Db): SubredditRow[] {
  return db.select().from(subreddits).all();
}

/** Poll state for scheduling, including when the last-seen newest post was created. */
export function pollStates(db: Db, names: string[]): SubredditPollState[] {
  const rows = getSubreddits(db, names);
  const newestIds = rows.map((row) => row.lastNewestId).filter((id): id is string => id !== null);
  const created = new Map(
    newestIds.length === 0
      ? []
      : db
          .select({ id: posts.id, createdAt: posts.createdAt })
          .from(posts)
          .where(inArray(posts.id, newestIds))
          .all()
          .map((row) => [row.id, row.createdAt] as const),
  );
  return rows.map((row) => ({
    name: row.name,
    status: row.status,
    lastPolledAt: row.lastPolledAt,
    pollIntervalMinutes: row.pollIntervalMinutes,
    blockUntil: row.blockUntil,
    previousNewestAt: row.lastNewestId === null ? null : (created.get(row.lastNewestId) ?? null),
  }));
}

export function recordPoll(
  db: Db,
  name: string,
  update: {
    now: number;
    newestId: string | null;
    postsPerDay: number | null;
    /** undefined leaves the interval unchanged; null restores the default. */
    pollIntervalMinutes?: number | null;
  },
): void {
  db.update(subreddits)
    .set({
      lastPolledAt: update.now,
      ...(update.newestId !== null ? { lastNewestId: update.newestId } : {}),
      ...(update.postsPerDay !== null ? { postsPerDay: update.postsPerDay } : {}),
      ...(update.pollIntervalMinutes !== undefined
        ? { pollIntervalMinutes: update.pollIntervalMinutes }
        : {}),
    })
    .where(eq(subreddits.name, name))
    .run();
}

export function setSubredditStatus(db: Db, name: string, status: SubredditStatus): void {
  db.update(subreddits).set({ status }).where(eq(subreddits.name, name)).run();
}

export function setBlockUntil(db: Db, names: string[], blockUntil: number): void {
  if (names.length === 0) return;
  db.update(subreddits).set({ blockUntil }).where(inArray(subreddits.name, names)).run();
}

export function setPromotionPolicy(db: Db, name: string, policy: PromotionPolicy): void {
  db.update(subreddits).set({ promotionPolicy: policy }).where(eq(subreddits.name, name)).run();
}

export function saveRules(
  db: Db,
  name: string,
  rules: { text: string; summary: RulesSummary; now: number },
): void {
  db.update(subreddits)
    .set({ rulesText: rules.text, rulesSummaryJson: rules.summary, rulesUpdatedAt: rules.now })
    .where(eq(subreddits.name, name))
    .run();
}

export function rulesSummaryOf(row: SubredditRow | null): RulesSummary | null {
  if (!row?.rulesSummaryJson) return null;
  const parsed = rulesSummaryWire.safeParse(row.rulesSummaryJson);
  return parsed.success ? parsed.data : null;
}
