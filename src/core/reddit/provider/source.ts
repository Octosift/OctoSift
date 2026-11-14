/**
 * Reads subreddits through a paid Reddit data provider.
 *
 * A scan reads a few feed pages per due subreddit, which carry previews only.
 * The free filters run on those previews, and the survivors' full posts are
 * then fetched in batches, so a typical scan costs one or two requests per
 * subreddit. Every billed request is reported through the spend hooks and
 * refused once the budget is spent.
 */
import { nowSeconds, type Clock } from '../../clock';
import { CONFIG } from '../../config';
import {
  normalizeSubredditName,
  type DetailsResult,
  type FetchOptions,
  type FetchResult,
  type RedditPost,
  type RedditSource,
  type SpendHooks,
} from '../types';
import type { ProviderAnswer, ProviderClient } from './vendor';
import { parseCommunityNames, parseDetails, parseFeedPage } from './vendor-parse';

const VALID_NAME = /^[a-z0-9_]{2,21}$/;

export interface ProviderSourceOptions {
  client: ProviderClient;
  clock: Clock;
  maxPostAgeHours: () => number;
  /** Price of one billed request, in USD. */
  pricePerRequestUsd: () => number;
  /** A name for usage records, such as the adapter's id. */
  name: string;
}

export interface ProviderSource extends RedditSource {
  fetchDetails(ids: string[], opts: { spend?: SpendHooks }): Promise<DetailsResult>;
  findCommunities(query: string, opts: { spend?: SpendHooks }): Promise<string[] | null>;
  /** The raw comments answer for a post, for visibility checks. */
  fetchComments(postId: string, opts: { spend?: SpendHooks }): Promise<ProviderAnswer>;
}

export function createProviderSource(options: ProviderSourceOptions): ProviderSource {
  const { client, clock } = options;

  /** One billed call: asks the budget first and records the cost after. */
  async function call(
    what: string,
    path: string,
    params: Record<string, string>,
    spend: SpendHooks | undefined,
  ): Promise<ProviderAnswer> {
    const refused = spend?.refuse() ?? null;
    if (refused !== null) return { ok: false, kind: 'budget', message: refused };
    const answer = await client.get(path, params);
    if (answer.billed) spend?.record(options.pricePerRequestUsd(), `${options.name}/${what}`);
    return answer;
  }

  async function readSubreddit(name: string, opts: FetchOptions): Promise<FetchResult> {
    const now = nowSeconds(clock);
    const maxAgeS = options.maxPostAgeHours() * 3600;
    const posts: RedditPost[] = [];
    let after: string | null = null;
    const pages = Math.min(CONFIG.provider.feedPages, opts.maxPages ?? CONFIG.provider.feedPages);
    for (let page = 0; page < pages; page += 1) {
      const answer = await call(
        'feed',
        '/v1/reddit/subreddit_feed',
        { subreddit_name: name, sort: 'NEW', ...(after ? { after } : {}) },
        opts.spend,
      );
      if (!answer.ok) {
        // Later pages failing keep what was read; the first page failing is reported.
        if (page > 0 && answer.kind !== 'auth' && answer.kind !== 'budget') break;
        return { ok: false, kind: answer.kind, message: answer.message };
      }
      const parsed = parseFeedPage(answer.data, name, now);
      if (!parsed) {
        if (page === 0) return { ok: false, kind: 'gone', message: 'Not a subreddit feed' };
        break;
      }
      posts.push(...parsed.posts);
      const known = opts.knownIds?.(parsed.posts.map((post) => post.id)) ?? new Set<string>();
      const reachedOld = parsed.posts.some(
        (post) => known.has(post.id) || now - post.createdAt > maxAgeS,
      );
      after = parsed.next;
      if (!after || reachedOld) break;
    }
    const unique = [...new Map(posts.map((post) => [post.id, post])).values()];
    unique.sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true, posts: unique, rate: { used: null, remaining: null, resetS: null } };
  }

  return {
    maxSubredditsPerRequest: 1,

    async fetchNewPosts(subreddits, opts) {
      const names = subreddits.map(normalizeSubredditName);
      if (names.length === 0 || names.some((name) => !VALID_NAME.test(name))) {
        return { ok: false, kind: 'gone', message: 'Invalid subreddit name' };
      }
      const posts: RedditPost[] = [];
      for (const name of names) {
        const result = await readSubreddit(name, opts);
        if (!result.ok) return result;
        posts.push(...result.posts);
      }
      return { ok: true, posts, rate: { used: null, remaining: null, resetS: null } };
    },

    async fetchDetails(ids, opts) {
      const posts: RedditPost[] = [];
      const batch = CONFIG.provider.detailsBatch;
      for (let start = 0; start < ids.length; start += batch) {
        const answer = await call(
          'details',
          '/v1/reddit/post_details_batch',
          { post_ids: ids.slice(start, start + batch).join(','), need_format: 'true' },
          opts.spend,
        );
        if (!answer.ok) {
          if (posts.length > 0 && answer.kind !== 'auth' && answer.kind !== 'budget') break;
          return { ok: false, kind: answer.kind, message: answer.message };
        }
        posts.push(...parseDetails(answer.data, nowSeconds(clock)));
      }
      return { ok: true, posts };
    },

    async findCommunities(query, opts) {
      const answer = await call(
        'search',
        '/v1/reddit/community_search',
        { query, search_type: 'community', need_format: 'true' },
        opts.spend,
      );
      return answer.ok ? parseCommunityNames(answer.data) : null;
    },

    fetchComments(postId, opts) {
      return call(
        'comments',
        '/v1/reddit/post_comments',
        { post_id: postId, sort_type: 'NEW', need_format: 'true' },
        opts.spend,
      );
    },
  };
}
