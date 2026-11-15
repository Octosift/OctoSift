/**
 * Warns before the founder posts a reply that would make their account look
 * promotional. The app never posts, but it knows which leads were marked as
 * replied and whether those replies mentioned the product. Warnings never
 * block anything; they explain the risk.
 */
import { and, eq, gte } from 'drizzle-orm';
import { CONFIG } from '../config';
import type { Db } from '../db/client';
import { leads, posts } from '../db/schema';

export interface PastReply {
  subreddit: string;
  /** Epoch seconds. */
  repliedAt: number;
  mentionedProduct: boolean;
}

export type PacingRule = 'same_subreddit' | 'daily_mentions' | 'helpful_ratio';

export interface PacingWarning {
  rule: PacingRule;
  message: string;
}

export const PACING_REASON =
  'Moderators remove accounts that mostly promote, so spread product mentions out and keep helping without them.';

const DAY_S = 24 * 3600;

export function pacingWarnings(input: {
  replies: PastReply[];
  subreddit: string;
  mentionsProduct: boolean;
  now: number;
}): PacingWarning[] {
  if (!input.mentionsProduct) return [];
  const { pacing } = CONFIG;
  const mentions = input.replies.filter((reply) => reply.mentionedProduct);
  const within = (reply: PastReply, days: number) => input.now - reply.repliedAt <= days * DAY_S;
  const warnings: PacingWarning[] = [];

  const sameSubreddit = mentions.filter(
    (reply) =>
      reply.subreddit === input.subreddit && within(reply, pacing.sameSubredditMentionWindowDays),
  ).length;
  if (sameSubreddit >= pacing.maxMentionsPerSubredditInWindow) {
    warnings.push({
      rule: 'same_subreddit',
      message: `You already mentioned the product in r/${input.subreddit} in the last ${pacing.sameSubredditMentionWindowDays} days.`,
    });
  }

  const today = mentions.filter((reply) => within(reply, 1)).length;
  if (today >= pacing.maxMentionsPerDay) {
    warnings.push({
      rule: 'daily_mentions',
      message: `You have already posted ${today} replies that mention the product in the last 24 hours.`,
    });
  }

  const recent = input.replies.filter((reply) => within(reply, pacing.helpfulPerMentionWindowDays));
  const recentMentions = recent.filter((reply) => reply.mentionedProduct).length;
  const helpful = recent.length - recentMentions;
  const needed = pacing.helpfulRepliesPerMention * (recentMentions + 1) - helpful;
  if (needed > 0) {
    const replies = needed === 1 ? 'reply' : 'replies';
    warnings.push({
      rule: 'helpful_ratio',
      message:
        `Post ${needed} more helpful ${replies} without a mention before this one. ` +
        `Reddit trusts accounts that help first: aim for ${pacing.helpfulRepliesPerMention} for each ` +
        `mention (last ${pacing.helpfulPerMentionWindowDays} days: ${helpful} helpful, ` +
        `${recentMentions} with a mention).`,
    });
  }
  return warnings;
}

/** Replies the founder marked as posted since the given time, across all products. */
export function recentReplies(db: Db, since: number): PastReply[] {
  return db
    .select({
      subreddit: posts.subreddit,
      repliedAt: leads.repliedAt,
      mentioned: leads.repliedWithMention,
    })
    .from(leads)
    .innerJoin(posts, eq(posts.id, leads.postId))
    .where(and(eq(leads.status, 'replied'), gte(leads.repliedAt, since)))
    .all()
    .map((row) => ({
      subreddit: row.subreddit,
      repliedAt: row.repliedAt ?? since,
      mentionedProduct: row.mentioned ?? false,
    }));
}
