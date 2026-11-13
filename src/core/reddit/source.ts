/**
 * Reads Reddit through public Atom feeds; no account or credentials needed.
 * One request returns up to 100 new posts with full bodies, for one
 * subreddit or several combined.
 */
import { nowSeconds, type Clock } from '../clock';
import { parseFeed, parseThreadFeed } from './atom';
import type { RedditClient } from './client';
import { normalizeSubredditName, type FetchResult, type RedditSource } from './types';

const VALID_NAME = /^[a-z0-9_]{2,21}$/;

export interface AtomSourceOptions {
  client: RedditClient;
  clock: Clock;
}

export function createAtomSource({
  client,
  clock,
}: AtomSourceOptions): Required<Pick<RedditSource, 'fetchNewPosts' | 'fetchPostWithComments'>> &
  RedditSource {
  return {
    async fetchNewPosts(subreddits, { limit }): Promise<FetchResult> {
      const names = subreddits.map(normalizeSubredditName);
      if (names.length === 0 || names.some((name) => !VALID_NAME.test(name))) {
        return { ok: false, kind: 'gone', message: 'Invalid subreddit name' };
      }
      const response = await client.getFeed(`/r/${names.join('+')}/new/.rss?limit=${limit}`);
      if (!response.ok) {
        const { ok, kind, retryAfterS, message } = response;
        return retryAfterS === undefined
          ? { ok, kind, message }
          : { ok, kind, retryAfterS, message };
      }
      const parsed = parseFeed(response.body, { now: nowSeconds(clock) });
      if (parsed.kind === 'not_found') return { ok: false, kind: 'gone' };
      if (parsed.kind === 'invalid') return { ok: false, kind: 'network', message: parsed.reason };
      return { ok: true, posts: parsed.posts, rate: response.rate };
    },

    async fetchPostWithComments(subreddit, postId) {
      const name = normalizeSubredditName(subreddit);
      const id = postId.replace(/^t3_/, '');
      if (!VALID_NAME.test(name) || !/^[a-z0-9]+$/i.test(id)) return null;
      const response = await client.getFeed(`/r/${name}/comments/${id}/.rss`);
      if (!response.ok) return null;
      return parseThreadFeed(response.body, { now: nowSeconds(clock) });
    },
  };
}
