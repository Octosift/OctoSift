/**
 * The fetch step of a scan: read the due subreddits and store new posts.
 *
 * Quiet subreddits share combined feeds, busy ones are read alone. A block
 * stops all reading for the rest of the scan and records when reads may
 * resume. A combined request for a subreddit that no longer exists is split
 * into single requests so the missing one can be identified.
 */
import { CONFIG } from '../config';
import type { Db } from '../db/client';
import { knownPostIds, postsWithHashes, type PostRow } from '../db/queries/posts';
import { pollStates } from '../db/queries/subreddits';
import type { Logger } from '../log';
import { estimatePostsPerDay } from '../profile/subreddits';
import {
  dueSubreddits,
  nextPollIntervals,
  planRequests,
  selectNewPosts,
  type SubredditPollState,
} from '../reddit/polling';
import type { RedditPost, RedditSource } from '../reddit/types';
import { contentHash, findCrossposts } from './dedup';
import type { FunnelCounts } from './funnel';
import type { ScanStore } from './store';

export interface CollectContext {
  db: Db;
  source: RedditSource;
  store: ScanStore;
  counts: FunnelCounts;
  log: Logger;
  /** Epoch seconds. */
  now: number;
  defaultIntervalMinutes: number;
  /** Aborted when the scan must stop reading, for example after losing the scan lock. */
  signal?: AbortSignal;
}

export interface CollectResult {
  newPostIds: string[];
  /** Epoch seconds when Reddit reads may resume, if a block happened. */
  blockedUntil: number | null;
}

function storePosts(ctx: CollectContext, selected: RedditPost[]): string[] {
  const hashed = selected.map((post) => ({ post, hash: contentHash(post.title, post.bodyText) }));
  const existing = postsWithHashes(
    ctx.db,
    hashed.map((item) => item.hash),
  );
  const crossposts = findCrossposts(
    hashed.map(({ post, hash }) => ({
      id: post.id,
      subreddit: post.subreddit,
      createdAt: post.createdAt,
      contentHash: hash,
    })),
    existing,
  );
  const rows: PostRow[] = hashed.map(({ post, hash }) => ({
    id: post.id,
    subreddit: post.subreddit,
    author: post.author,
    title: post.title,
    bodyText: post.bodyText,
    bodyLinksJson: post.bodyLinks,
    url: post.url,
    imageUrl: post.imageUrl,
    createdAt: post.createdAt,
    fetchedAt: ctx.now,
    contentHash: hash,
    duplicateOf: crossposts.get(post.id) ?? null,
    score: post.score ?? null,
    commentCount: post.commentCount ?? null,
    nsfw: post.nsfw ?? false,
    locked: post.locked ?? false,
    removed: post.removed ?? false,
    partial: post.partial ?? false,
  }));
  ctx.store.insertPosts(rows);
  return rows.map((row) => row.id);
}

function recordPolls(ctx: CollectContext, states: SubredditPollState[], posts: RedditPost[]): void {
  const intervals = nextPollIntervals({
    states,
    posts,
    limit: CONFIG.reddit.feedLimit,
    defaultIntervalMinutes: ctx.defaultIntervalMinutes,
    minIntervalMinutes: CONFIG.schedule.minIntervalMinutes,
  });
  for (const state of states) {
    const own = posts.filter((post) => post.subreddit === state.name);
    ctx.store.recordPoll(state.name, {
      now: ctx.now,
      newestId: own[0]?.id ?? null,
      postsPerDay: own.length > 0 ? estimatePostsPerDay(own, ctx.now) : null,
      pollIntervalMinutes: intervals.has(state.name)
        ? (intervals.get(state.name) ?? null)
        : undefined,
    });
  }
}

export async function collectPosts(
  ctx: CollectContext,
  names: string[],
  options: { ignoreSchedule: boolean },
): Promise<CollectResult> {
  const states = pollStates(ctx.db, names);
  const byName = new Map(states.map((state) => [state.name, state]));
  const due = options.ignoreSchedule
    ? states.filter(
        (state) =>
          state.status === 'active' && (state.blockUntil === null || state.blockUntil <= ctx.now),
      )
    : dueSubreddits(states, { now: ctx.now, defaultIntervalMinutes: ctx.defaultIntervalMinutes });
  const queue = planRequests(
    due,
    ctx.source.maxSubredditsPerRequest ?? CONFIG.reddit.maxSubredditsPerRequest,
  );
  const newPostIds: string[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    if (ctx.signal?.aborted) break;
    const request = queue[index] ?? [];
    const result = await ctx.source.fetchNewPosts(request, {
      limit: CONFIG.reddit.feedLimit,
      knownIds: (ids) => knownPostIds(ctx.db, ids),
    });
    if (!result.ok) {
      if (result.kind === 'blocked' || result.kind === 'rate_limited') {
        const until = ctx.now + (result.retryAfterS ?? CONFIG.reddit.blockPauseMs / 1000);
        const unread = queue.slice(index).flat();
        ctx.store.setBlockUntil(unread, until);
        ctx.counts.blocked = true;
        ctx.log.warn('Reddit reads paused during scan', { until, unread: unread.length });
        return { newPostIds, blockedUntil: until };
      }
      if (result.kind === 'auth') {
        // The account or key stopped working; every further request would fail the same way.
        ctx.counts.redditErrors += 1;
        ctx.log.warn('Reddit source needs attention; reads stopped', { reason: result.message });
        return { newPostIds, blockedUntil: null };
      }
      if (result.kind === 'gone') {
        if (request.length === 1 && request[0] !== undefined) {
          ctx.store.setSubredditStatus(request[0], 'gone');
          ctx.log.warn('Subreddit no longer exists', { subreddit: request[0] });
        } else {
          queue.push(...request.map((name) => [name]));
        }
        continue;
      }
      ctx.counts.redditErrors += 1;
      ctx.log.warn('Could not read subreddits', { subreddits: request, reason: result.message });
      continue;
    }

    ctx.counts.fetched += result.posts.length;
    const known = knownPostIds(
      ctx.db,
      result.posts.map((post) => post.id),
    );
    const requestStates = request
      .map((name) => byName.get(name))
      .filter((state): state is SubredditPollState => state !== undefined);
    const selected = selectNewPosts(result.posts, {
      knownIds: known,
      firstPoll: new Set(requestStates.filter((s) => s.lastPolledAt === null).map((s) => s.name)),
      now: ctx.now,
      firstPollWindowS: CONFIG.reddit.firstPollWindowS,
    });
    newPostIds.push(...storePosts(ctx, selected));
    ctx.counts.new += selected.length;
    recordPolls(ctx, requestStates, result.posts);
  }
  return { newPostIds, blockedUntil: null };
}
