/**
 * Decides which subreddits to read, how to group them into requests, and
 * which posts in a feed are new.
 *
 * A feed returns at most `limit` entries. When a full feed does not reach
 * back to the newest post seen last time, posts may have been missed, so
 * that subreddit is read on its own and more often. Quiet subreddits share a
 * combined feed to save requests, which are the scarce resource.
 */
import type { RedditPost } from './types';

export interface SubredditPollState {
  name: string;
  status: 'active' | 'paused' | 'gone';
  /** Epoch seconds. */
  lastPolledAt: number | null;
  /** Set for busy subreddits, which are read alone at this interval. */
  pollIntervalMinutes: number | null;
  /** Epoch seconds; reads of this subreddit wait until then. */
  blockUntil: number | null;
  /** Creation time of the newest post seen in the previous poll, epoch seconds. */
  previousNewestAt: number | null;
}

export function dueSubreddits(
  states: SubredditPollState[],
  { now, defaultIntervalMinutes }: { now: number; defaultIntervalMinutes: number },
): SubredditPollState[] {
  return states.filter((state) => {
    if (state.status !== 'active') return false;
    if (state.blockUntil !== null && state.blockUntil > now) return false;
    if (state.lastPolledAt === null) return true;
    const intervalS = (state.pollIntervalMinutes ?? defaultIntervalMinutes) * 60;
    return now - state.lastPolledAt >= intervalS;
  });
}

/** Busy subreddits get a request each; quiet ones are combined, `groupSize` per request. */
export function planRequests(due: SubredditPollState[], groupSize: number): string[][] {
  const byName = (a: SubredditPollState, b: SubredditPollState) => a.name.localeCompare(b.name);
  const busy = due.filter((state) => state.pollIntervalMinutes !== null).sort(byName);
  const quiet = due.filter((state) => state.pollIntervalMinutes === null).sort(byName);
  const requests = busy.map((state) => [state.name]);
  for (let index = 0; index < quiet.length; index += groupSize) {
    requests.push(quiet.slice(index, index + groupSize).map((state) => state.name));
  }
  return requests;
}

export interface IntervalInput {
  /** The subreddits that were read together in one request. */
  states: SubredditPollState[];
  /** Every entry the request returned, newest first. */
  posts: RedditPost[];
  limit: number;
  /** The source said it may have stopped before reaching the posts it had seen. */
  truncated?: boolean;
  defaultIntervalMinutes: number;
  minIntervalMinutes: number;
}

/**
 * Returns the new interval for each subreddit whose schedule should change
 * (null meaning "back to the default schedule"). Subreddits not in the map
 * keep their current interval.
 */
export function nextPollIntervals(input: IntervalInput): Map<string, number | null> {
  const { states, posts, limit, defaultIntervalMinutes, minIntervalMinutes } = input;
  const changes = new Map<string, number | null>();
  const counts = new Map<string, number>();
  for (const post of posts) counts.set(post.subreddit, (counts.get(post.subreddit) ?? 0) + 1);

  if (posts.length >= limit || input.truncated === true) {
    const oldest = Math.min(...posts.map((post) => post.createdAt));
    const atRisk = states.filter(
      (state) => state.previousNewestAt !== null && oldest > state.previousNewestAt,
    );
    if (atRisk.length === 0) return changes;
    // In a combined feed the loudest member crowds out the others; read it alone.
    const busiest = [...states].sort(
      (a, b) =>
        (counts.get(b.name) ?? 0) - (counts.get(a.name) ?? 0) || a.name.localeCompare(b.name),
    )[0];
    if (busiest) {
      const current = busiest.pollIntervalMinutes ?? defaultIntervalMinutes;
      changes.set(busiest.name, Math.max(minIntervalMinutes, Math.floor(current / 2)));
    }
    return changes;
  }

  for (const state of states) {
    if (state.pollIntervalMinutes === null) continue;
    const fresh = posts.filter(
      (post) =>
        post.subreddit === state.name &&
        (state.previousNewestAt === null || post.createdAt > state.previousNewestAt),
    ).length;
    if (fresh < limit / 4) {
      const relaxed = state.pollIntervalMinutes * 2;
      changes.set(state.name, relaxed >= defaultIntervalMinutes ? null : relaxed);
    }
  }
  return changes;
}

export interface SelectOptions {
  /** Ids from this feed that are already stored. */
  knownIds: Set<string>;
  /** Subreddits being read for the first time. */
  firstPoll: Set<string>;
  now: number;
  firstPollWindowS: number;
}

/**
 * Keeps the posts that still need processing. Feeds are newest first, so a
 * subreddit's posts stop at its first already-stored post. On a first poll
 * only recent posts count, so adding a subreddit does not flood the inbox.
 */
export function selectNewPosts(posts: RedditPost[], options: SelectOptions): RedditPost[] {
  const { knownIds, firstPoll, now, firstPollWindowS } = options;
  const finished = new Set<string>();
  const selected: RedditPost[] = [];
  for (const post of posts) {
    if (finished.has(post.subreddit)) continue;
    if (knownIds.has(post.id)) {
      finished.add(post.subreddit);
      continue;
    }
    if (firstPoll.has(post.subreddit) && now - post.createdAt > firstPollWindowS) continue;
    selected.push(post);
  }
  return selected;
}
