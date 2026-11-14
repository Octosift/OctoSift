/**
 * Reads subreddits through Reddit's JSON listings with the user's connected
 * account. The newest-first listing is not available to these sessions, so
 * the source reads the "hot" listing, which covers recent posts well, and
 * adds the day's top posts for subreddits too busy for three hot pages.
 *
 * One subreddit per request. Each listing post carries its full text, score,
 * comment count and flags, so no per-post requests are needed.
 */
import { z } from 'zod';
import { nowSeconds, type Clock } from '../clock';
import { CONFIG } from '../config';
import type { SessionClient } from './session-client';
import {
  normalizeSubredditName,
  type FetchOptions,
  type FetchResult,
  type RedditPost,
  type RedditSource,
} from './types';

const VALID_NAME = /^[a-z0-9_]{2,21}$/;
const DAY_S = 86_400;
const LINK = /https?:\/\/[^\s)\]>"']+/g;
const IMAGE_HOST = /(^|\.)redd\.it$|(^|\.)redditmedia\.com$/;

const postData = z.object({
  id: z.string().regex(/^[a-z0-9]+$/i),
  subreddit: z.string(),
  author: z.string().catch('[deleted]'),
  title: z.string().catch(''),
  selftext: z.string().catch(''),
  created_utc: z.number(),
  permalink: z.string(),
  url: z.string().nullish(),
  score: z.number().nullish(),
  num_comments: z.number().nullish(),
  over_18: z.boolean().catch(false),
  locked: z.boolean().catch(false),
  stickied: z.boolean().catch(false),
  archived: z.boolean().catch(false),
  removed_by_category: z.string().nullish(),
  post_hint: z.string().nullish(),
  preview: z
    .object({
      images: z.array(z.object({ source: z.object({ url: z.string() }) })).catch([]),
    })
    .nullish()
    .catch(null),
});

const listingSchema = z.object({
  kind: z.literal('Listing'),
  data: z.object({
    after: z.string().nullish(),
    children: z.array(z.object({ kind: z.string(), data: z.unknown() })),
  }),
});

interface ListingPage {
  posts: (RedditPost & { stickied: boolean })[];
  after: string | null;
}

function imageOf(data: z.output<typeof postData>): string | null {
  const candidates = [data.url, data.preview?.images[0]?.source.url];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && IMAGE_HOST.test(url.hostname)) return url.href;
    } catch {
      // Not an absolute address; skip it.
    }
  }
  return null;
}

function toPost(data: z.output<typeof postData>, now: number): RedditPost & { stickied: boolean } {
  const createdAt = Math.floor(data.created_utc);
  const body = data.selftext.trim();
  return {
    id: `t3_${data.id.toLowerCase()}`,
    subreddit: normalizeSubredditName(data.subreddit),
    author: data.author,
    title: data.title.trim(),
    bodyText:
      body.length > CONFIG.reddit.maxBodyChars
        ? `${body.slice(0, CONFIG.reddit.maxBodyChars).trimEnd()}\n\n[truncated]`
        : body,
    bodyLinks: body.match(LINK) ?? [],
    url: `https://www.reddit.com${data.permalink}`,
    imageUrl: imageOf(data),
    createdAt,
    archived: data.archived || now - createdAt > CONFIG.reddit.archiveAfterS,
    score: data.score ?? null,
    commentCount: data.num_comments ?? null,
    nsfw: data.over_18,
    locked: data.locked,
    removed: Boolean(data.removed_by_category) || body === '[removed]',
    stickied: data.stickied,
  };
}

/** Parses one listing page; posts that do not parse are skipped. */
export function parseListing(json: unknown, now: number): ListingPage | null {
  const listing = listingSchema.safeParse(json);
  if (!listing.success) return null;
  const posts: ListingPage['posts'] = [];
  for (const child of listing.data.data.children) {
    if (child.kind !== 't3') continue;
    const data = postData.safeParse(child.data);
    if (data.success) posts.push(toPost(data.data, now));
  }
  return { posts, after: listing.data.data.after ?? null };
}

export interface SessionSourceOptions {
  client: SessionClient;
  clock: Clock;
  /** The prefilter's age limit, so paging stops once posts are older. */
  maxPostAgeHours: () => number;
}

export function createSessionSource(options: SessionSourceOptions): RedditSource {
  const { client, clock } = options;

  async function readListing(
    path: string,
    pages: number,
    stop: (page: ListingPage) => boolean,
  ): Promise<{ ok: true; posts: ListingPage['posts'] } | Exclude<FetchResult, { ok: true }>> {
    const posts: ListingPage['posts'] = [];
    let after: string | null = null;
    for (let page = 0; page < pages; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const response = await client.getJson(
        `${path}${separator}limit=100&raw_json=1${after ? `&after=${after}` : ''}`,
      );
      if (!response.ok) {
        // A later page failing for an ordinary reason keeps what was read.
        if (page > 0 && response.kind === 'network') break;
        const { kind, message } = response;
        return response.retryAfterS === undefined
          ? { ok: false, kind, message }
          : { ok: false, kind, message, retryAfterS: response.retryAfterS };
      }
      const parsed = parseListing(response.json, nowSeconds(clock));
      if (!parsed) {
        if (page === 0) return { ok: false, kind: 'gone', message: 'Not a subreddit listing' };
        break;
      }
      posts.push(...parsed.posts);
      after = parsed.after;
      if (!after || stop(parsed)) break;
    }
    return { ok: true, posts };
  }

  async function readSubreddit(name: string, opts: FetchOptions): Promise<FetchResult> {
    const known = opts.knownIds ?? (() => new Set<string>());
    const now = nowSeconds(clock);
    const maxAgeS = options.maxPostAgeHours() * 3600;
    const reachedOld = (page: ListingPage) => {
      const fresh = page.posts.filter((post) => !post.stickied);
      const seen = known(fresh.map((post) => post.id));
      return fresh.some((post) => now - post.createdAt > maxAgeS || seen.has(post.id));
    };
    const pages = Math.min(CONFIG.session.hotPages, opts.maxPages ?? CONFIG.session.hotPages);
    const hot = await readListing(`/r/${name}.json`, pages, reachedOld);
    if (!hot.ok) return hot;
    let all = hot.posts;
    const unpinned = hot.posts.filter((post) => !post.stickied);
    // Three full hot pages all from the last day: the subreddit is busy, so add the day's top.
    const busy =
      opts.maxPages === undefined &&
      unpinned.length >= CONFIG.session.hotPages * 100 - 10 &&
      unpinned.every((post) => now - post.createdAt < DAY_S);
    if (busy) {
      const top = await readListing(
        `/r/${name}/top.json?t=day`,
        CONFIG.session.topPages,
        () => false,
      );
      if (top.ok) all = [...all, ...top.posts];
    }
    const byId = new Map<string, RedditPost>();
    for (const post of all) {
      if (post.stickied || byId.has(post.id)) continue;
      const { stickied: _stickied, ...rest } = post;
      byId.set(post.id, rest);
    }
    const posts = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
    // A subreddit this busy may hide posts between hot and top; it should be read more often.
    return {
      ok: true,
      posts,
      rate: { used: null, remaining: null, resetS: null },
      truncated: busy,
    };
  }

  return {
    maxSubredditsPerRequest: 1,
    async fetchNewPosts(subreddits, opts) {
      const names = subreddits.map(normalizeSubredditName);
      if (names.length === 0 || names.some((name) => !VALID_NAME.test(name))) {
        return { ok: false, kind: 'gone', message: 'Invalid subreddit name' };
      }
      const posts: RedditPost[] = [];
      let truncated = false;
      for (const name of names) {
        const result = await readSubreddit(name, opts);
        if (!result.ok) return result;
        posts.push(...result.posts);
        truncated ||= result.truncated === true;
      }
      return { ok: true, posts, rate: { used: null, remaining: null, resetS: null }, truncated };
    },
  };
}
