/**
 * Checks that the founder's posted replies stay up.
 *
 * When a lead is marked as replied with the comment's link, two checks are
 * scheduled, an hour and a day later. Each reads the comment's own permalink
 * through the connected Reddit session, which shows the comment the way other
 * people see it: there, "[removed]", or missing. That only holds when the
 * reply was posted from a different account, because Reddit shows authors
 * their own removed comments, so a reply from the connected account itself is
 * reported as unknown.
 *
 * A removed reply in one subreddit is often a filter; removed replies in
 * several subreddits within a week suggest the account itself is being hidden.
 *
 * These reads go through the session's limiter, so they share its pacing and
 * hourly cap with scans. Only a refusal or a sign-in redirect marks the
 * session for reconnecting; any other failure is retried a few times.
 */
import { and, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { CONFIG } from '../config';
import type { Db } from '../db/client';
import { leads, posts, replyChecks } from '../db/schema';
import { newId } from '../ids';
import type { Logger } from '../log';
import type { SessionClient } from '../reddit/session-client';
import { normalizeRedditUrl } from '../urls';

export type ReplyCheckResult = 'visible' | 'removed' | 'post_gone' | 'unknown';

export interface CommentLink {
  subreddit: string;
  postId: string;
  commentId: string;
  /** The permalink's path, as Reddit serves it, ending in a slash. */
  path: string;
}

const PERMALINK =
  /^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]+)\/([\w%-]{1,120})\/([a-z0-9]+)\/?$/i;

/** Reads a comment permalink; null for links that are not to a comment. */
export function parseCommentLink(raw: string): CommentLink | null {
  // Any Reddit host, with or without https://, in its canonical form.
  const normalized = normalizeRedditUrl(raw);
  if (normalized === null) return null;
  const match = PERMALINK.exec(new URL(normalized).pathname);
  const [, subreddit, post, slug, comment] = match ?? [];
  if (!subreddit || !post || !slug || !comment) return null;
  return {
    subreddit: subreddit.toLowerCase(),
    postId: `t3_${post.toLowerCase()}`,
    commentId: `t1_${comment.toLowerCase()}`,
    path: `/r/${subreddit}/comments/${post.toLowerCase()}/${slug}/${comment.toLowerCase()}/`,
  };
}

const thing = z.object({ kind: z.string(), data: z.record(z.string(), z.unknown()) });
const listing = z.object({ data: z.object({ children: z.array(thing) }) });
const thread = z.tuple([listing, listing]).rest(z.unknown());
type Thing = z.output<typeof thing>;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function postIsGone(post: Thing['data']): boolean {
  const removedBy = post.removed_by_category;
  return (
    (typeof removedBy === 'string' && removedBy !== '') ||
    ['[removed]', '[deleted]'].includes(text(post.selftext))
  );
}

/** Finds a comment by fullname among a listing's comments and their replies. */
function findComment(children: Thing[], fullname: string): Thing['data'] | null {
  for (const child of children) {
    if (child.kind !== 't1') continue;
    if (text(child.data.name) === fullname || `t1_${text(child.data.id)}` === fullname) {
      return child.data;
    }
    const replies = listing.safeParse(child.data.replies);
    const found = replies.success ? findComment(replies.data.data.children, fullname) : null;
    if (found) return found;
  }
  return null;
}

/**
 * Judges a comment permalink's thread. `account` is the connected account's
 * name: its own comments look fine to it even when removed. Null when the
 * answer is not a thread at all.
 */
export function judgeThread(
  json: unknown,
  commentId: string,
  account: string | null,
): ReplyCheckResult | null {
  const parsed = thread.safeParse(json);
  if (!parsed.success) return null;
  const [postListing, commentListing] = parsed.data;
  const post = postListing.data.children.find((child) => child.kind === 't3')?.data;
  if (!post || postIsGone(post)) return 'post_gone';
  const comment = findComment(commentListing.data.children, commentId);
  if (!comment) return 'removed';
  if (['[removed]', '[deleted]'].includes(text(comment.body))) return 'removed';
  if (account?.toLowerCase() === text(comment.author).toLowerCase()) return 'unknown';
  return 'visible';
}

/** Schedules the 1-hour and 24-hour checks for a reply; returns false for an unusable link. */
export function scheduleReplyChecks(
  db: Db,
  input: { leadId: string; commentUrl: string; now: number },
): boolean {
  if (!parseCommentLink(input.commentUrl)) return false;
  db.delete(replyChecks).where(eq(replyChecks.leadId, input.leadId)).run();
  for (const check of CONFIG.visibility.replyChecks) {
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

function record(db: Db, id: string, result: ReplyCheckResult, now: number, attempts?: number) {
  db.update(replyChecks)
    .set({ result, checkedAt: now, ...(attempts === undefined ? {} : { attempts }) })
    .where(eq(replyChecks.id, id))
    .run();
}

/** Runs the checks that are due, a few at a time; returns how many got a result. */
export async function runDueReplyChecks(deps: {
  db: Db;
  reddit: Pick<SessionClient, 'getJson'>;
  /** The connected account's name, when known. */
  account: string | null;
  now: number;
  log: Logger;
}): Promise<number> {
  const { db, now, log } = deps;
  const { checksPerTick, retryAfterS, maxAttempts } = CONFIG.visibility;
  const due = db
    .select()
    .from(replyChecks)
    .where(and(isNull(replyChecks.result), lte(replyChecks.dueAt, now)))
    .orderBy(replyChecks.dueAt)
    .limit(checksPerTick)
    .all();
  let done = 0;
  for (const check of due) {
    const link = parseCommentLink(check.commentUrl);
    if (!link) {
      record(db, check.id, 'unknown', now);
      continue;
    }
    const answer = await deps.reddit.getJson(`${link.path}.json?raw_json=1`);
    let result: ReplyCheckResult | null = null;
    if (answer.ok) {
      result = judgeThread(answer.json, link.commentId, deps.account);
    } else if (
      answer.kind === 'auth' ||
      answer.kind === 'rate_limited' ||
      answer.kind === 'blocked'
    ) {
      // The session needs reconnecting, or its hourly allowance is used up: try later.
      log.warn('Reply checks paused', { reason: answer.message });
      break;
    } else if (answer.kind === 'gone' && (answer.status === 404 || answer.status === 403)) {
      // Not found, or the subreddit went private or was banned.
      result = 'post_gone';
    }
    if (result === null) {
      const attempts = check.attempts + 1;
      log.warn('Reply check could not run', {
        reason: answer.ok ? 'Not a comment thread' : answer.message,
        attempts,
      });
      if (attempts < maxAttempts) {
        db.update(replyChecks)
          .set({ attempts, dueAt: now + retryAfterS })
          .where(eq(replyChecks.id, check.id))
          .run();
        continue;
      }
      record(db, check.id, 'unknown', now, attempts);
    } else {
      record(db, check.id, result, now);
    }
    done += 1;
  }
  return done;
}

/** Subreddits where a reply was found removed in the last week, newest first. */
export function removedReplySubreddits(db: Db, now: number): string[] {
  const rows = db
    .select({ subreddit: posts.subreddit })
    .from(replyChecks)
    .innerJoin(leads, eq(leads.id, replyChecks.leadId))
    .innerJoin(posts, eq(posts.id, leads.postId))
    .where(
      and(
        eq(replyChecks.result, 'removed'),
        isNotNull(replyChecks.checkedAt),
        gte(replyChecks.checkedAt, now - CONFIG.visibility.multiSubredditWindowDays * 86_400),
      ),
    )
    .orderBy(desc(replyChecks.checkedAt))
    .all();
  return [...new Set(rows.map((row) => row.subreddit))];
}
