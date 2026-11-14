/**
 * Checks that the founder's posted replies can be seen by logged-out readers.
 *
 * When a lead is marked as replied with the comment's link, two checks are
 * scheduled, one hour and one day later. Each reads the post's comments
 * through the data provider and records whether the comment is there. A
 * hidden reply in one subreddit is often a filter; hidden replies in several
 * subreddits within a week suggest the account itself is being hidden.
 *
 * Only runs with a data provider, which has its own limiter, so these reads
 * never pause scanning.
 */
import { and, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { leads, posts, replyChecks } from '../db/schema';
import { newId } from '../ids';
import type { Logger } from '../log';
import type { ProviderSource } from '../reddit/provider/source';
import { containsComment, postPresent } from '../reddit/provider/vendor-parse';
import type { SpendHooks } from '../reddit/types';

export type ReplyCheckResult = 'visible' | 'hidden' | 'post_gone';

const CHECKS = [
  { kind: '1h', afterS: 3600 },
  { kind: '24h', afterS: 86_400 },
] as const;

const WEEK_S = 7 * 86_400;

export interface CommentLink {
  subreddit: string;
  postId: string;
  commentId: string;
}

const PERMALINK =
  /^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]+)\/(?:[^/]+\/|comment\/)?([a-z0-9]+)\/?$/i;

/** Reads a comment permalink; null for links that are not to a comment. */
export function parseCommentLink(raw: string): CommentLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // Not a link at all.
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'reddit.com' && !host.endsWith('.reddit.com')) return null;
  const match = PERMALINK.exec(url.pathname);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    subreddit: match[1].toLowerCase(),
    postId: `t3_${match[2].toLowerCase()}`,
    commentId: `t1_${match[3].toLowerCase()}`,
  };
}

/** Schedules the 1-hour and 24-hour checks for a reply; returns false for an unusable link. */
export function scheduleReplyChecks(
  db: Db,
  input: { leadId: string; commentUrl: string; now: number },
): boolean {
  if (!parseCommentLink(input.commentUrl)) return false;
  db.delete(replyChecks).where(eq(replyChecks.leadId, input.leadId)).run();
  for (const check of CHECKS) {
    db.insert(replyChecks)
      .values({
        id: newId(),
        leadId: input.leadId,
        commentUrl: input.commentUrl,
        dueAt: input.now + check.afterS,
        kind: check.kind,
        result: null,
        checkedAt: null,
      })
      .run();
  }
  return true;
}

export function replyChecksFor(db: Db, leadId: string) {
  return db
    .select()
    .from(replyChecks)
    .where(eq(replyChecks.leadId, leadId))
    .orderBy(replyChecks.dueAt)
    .all();
}

/** Runs the checks that are due; returns how many got a result. */
export async function runDueReplyChecks(deps: {
  db: Db;
  provider: Pick<ProviderSource, 'fetchComments'>;
  now: number;
  spend?: SpendHooks;
  log: Logger;
}): Promise<number> {
  const due = deps.db
    .select()
    .from(replyChecks)
    .where(and(isNull(replyChecks.result), lte(replyChecks.dueAt, deps.now)))
    .orderBy(replyChecks.dueAt)
    .limit(20)
    .all();
  let done = 0;
  for (const check of due) {
    const link = parseCommentLink(check.commentUrl);
    if (!link) continue;
    const answer = await deps.provider.fetchComments(link.postId, {
      ...(deps.spend ? { spend: deps.spend } : {}),
    });
    if (!answer.ok) {
      deps.log.warn('Reply check could not run', { kind: answer.kind, reason: answer.message });
      // A missing key or a spent budget fails every check the same way; try again later.
      if (answer.kind === 'auth' || answer.kind === 'budget') break;
      continue;
    }
    const result: ReplyCheckResult = !postPresent(answer.data)
      ? 'post_gone'
      : containsComment(answer.data, link.commentId)
        ? 'visible'
        : 'hidden';
    deps.db
      .update(replyChecks)
      .set({ result, checkedAt: deps.now })
      .where(eq(replyChecks.id, check.id))
      .run();
    done += 1;
  }
  return done;
}

/** Subreddits where a reply was found hidden in the last week, newest first. */
export function hiddenReplySubreddits(db: Db, now: number): string[] {
  const rows = db
    .select({ subreddit: posts.subreddit })
    .from(replyChecks)
    .innerJoin(leads, eq(leads.id, replyChecks.leadId))
    .innerJoin(posts, eq(posts.id, leads.postId))
    .where(
      and(
        eq(replyChecks.result, 'hidden'),
        isNotNull(replyChecks.checkedAt),
        gte(replyChecks.checkedAt, now - WEEK_S),
      ),
    )
    .orderBy(desc(replyChecks.checkedAt))
    .all();
  return [...new Set(rows.map((row) => row.subreddit))];
}
