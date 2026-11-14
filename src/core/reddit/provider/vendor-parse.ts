/**
 * Reads Vendor's Reddit app responses into posts. The responses are deeply
 * nested and only partly documented, so every reader is defensive: unknown
 * shapes are skipped and missing fields come out empty rather than failing.
 */
import { z } from 'zod';
import { CONFIG } from '../../config';
import { normalizeSubredditName, type RedditPost } from '../types';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function at(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Every object in a JSON tree, depth first; used where the nesting is not documented. */
function* objects(value: unknown, depth = 0): Generator<Json> {
  if (depth > 40) return;
  if (Array.isArray(value)) {
    for (const item of value) yield* objects(item, depth + 1);
  } else if (isObject(value)) {
    yield value;
    for (const child of Object.values(value)) yield* objects(child, depth + 1);
  }
}

function epochSeconds(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw))
    return raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw);
  if (typeof raw !== 'string' || raw === '') return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

const LINK = /https?:\/\/[^\s)\]>"']+/g;
const REDDIT_IMAGE = /^https:\/\/([a-z0-9-]+\.)*(redd\.it|redditmedia\.com)\//i;

function capBody(body: string): string {
  return body.length > CONFIG.reddit.maxBodyChars
    ? `${body.slice(0, CONFIG.reddit.maxBodyChars).trimEnd()}\n\n[truncated]`
    : body;
}

function firstRedditImage(value: unknown): string | null {
  for (const object of objects(value)) {
    for (const field of Object.values(object)) {
      if (typeof field === 'string' && REDDIT_IMAGE.test(field)) return field;
    }
  }
  return null;
}

export interface FeedPage {
  posts: RedditPost[];
  next: string | null;
}

/**
 * One page of a subreddit feed. Posts are cell groups with a t3_ id; ads
 * (groups with an ad cell), community carousels and the sort cell are skipped.
 * Bodies are previews, so posts are marked partial. Null when the answer is
 * not a subreddit feed, for example for a subreddit that does not exist.
 */
export function parseFeedPage(data: unknown, subreddit: string, now: number): FeedPage | null {
  const elements = at(data, 'subredditV3', 'elements');
  const edges = at(elements, 'edges');
  if (!Array.isArray(edges)) return null;
  const posts: RedditPost[] = [];
  for (const edge of edges) {
    const node = at(edge, 'node');
    if (!isObject(node) || node.__typename !== 'CellGroup') continue;
    const id = text(node.groupId);
    if (!/^t3_[a-z0-9]+$/i.test(id)) continue;
    const cells = Array.isArray(node.cells) ? node.cells.filter(isObject) : [];
    if (cells.some((cell) => cell.__typename === 'AdMetadataCell')) continue;
    const cell = (type: string) => cells.find((candidate) => candidate.__typename === type);
    const meta = cell('MetadataCell');
    const title = text((cell('TitleCell') ?? cell('TitleWithThumbnailCell'))?.title);
    const preview = text(cell('PreviewTextCell')?.text).trim();
    const name = normalizeSubredditName(text(meta?.subredditName) || subreddit);
    const createdAt = epochSeconds(meta?.createdAt) ?? now;
    posts.push({
      id: id.toLowerCase(),
      subreddit: name,
      author: text(meta?.authorName) || text(at(meta, 'author', 'name')) || '[unknown]',
      title: title.trim(),
      bodyText: preview,
      bodyLinks: preview.match(LINK) ?? [],
      url: `https://www.reddit.com/r/${name}/comments/${id.slice(3).toLowerCase()}/`,
      imageUrl: firstRedditImage(cell('ImageCell') ?? cell('TitleWithThumbnailCell')),
      createdAt,
      archived: now - createdAt > CONFIG.reddit.archiveAfterS,
      nsfw: meta?.isNsfw === true,
      partial: true,
    });
  }
  const endCursor = at(elements, 'pageInfo', 'endCursor');
  const hasNext = at(elements, 'pageInfo', 'hasNextPage');
  return {
    posts,
    next: typeof endCursor === 'string' && endCursor !== '' && hasNext !== false ? endCursor : null,
  };
}

const detail = z.object({
  id: z.string().regex(/^t3_[a-z0-9]+$/i),
  postTitle: z.string(),
  content: z.object({ markdown: z.string().nullish() }).nullish().catch(null),
  score: z.number().nullish().catch(null),
  commentCount: z.number().nullish().catch(null),
  isLocked: z.boolean().catch(false),
  isNsfw: z.boolean().catch(false),
  isRemoved: z.boolean().catch(false),
  createdAt: z.string(),
  permalink: z.string().nullish().catch(null),
  subreddit: z.object({ name: z.string() }).nullish().catch(null),
  authorInfo: z.object({ name: z.string() }).nullish().catch(null),
  url: z.string().nullish().catch(null),
});

/** Full posts from a details batch, wherever in the answer they appear. */
export function parseDetails(data: unknown, now: number): RedditPost[] {
  const found = new Map<string, RedditPost>();
  for (const object of objects(data)) {
    if (typeof object.postTitle !== 'string') continue;
    const parsed = detail.safeParse(object);
    if (!parsed.success) continue;
    const post = parsed.data;
    const id = post.id.toLowerCase();
    if (found.has(id)) continue;
    const createdAt = epochSeconds(post.createdAt) ?? now;
    const body = (post.content?.markdown ?? '').trim();
    const name = normalizeSubredditName(post.subreddit?.name ?? '');
    const permalink = post.permalink ?? '';
    found.set(id, {
      id,
      subreddit: name,
      author: post.authorInfo?.name ?? '[deleted]',
      title: post.postTitle.trim(),
      bodyText: capBody(body),
      bodyLinks: body.match(LINK) ?? [],
      url: permalink.startsWith('http')
        ? permalink
        : `https://www.reddit.com${permalink || `/r/${name}/comments/${id.slice(3)}/`}`,
      imageUrl: post.url && REDDIT_IMAGE.test(post.url) ? post.url : null,
      createdAt,
      archived: now - createdAt > CONFIG.reddit.archiveAfterS,
      score: post.score ?? null,
      commentCount: post.commentCount ?? null,
      nsfw: post.isNsfw,
      locked: post.isLocked,
      removed: post.isRemoved || body === '[removed]',
      partial: false,
    });
  }
  return [...found.values()];
}

/** Community names in a search answer (need_format=true). */
export function parseCommunityNames(data: unknown): string[] {
  const children = at(data, 'children');
  if (!Array.isArray(children)) return [];
  const names = new Set<string>();
  for (const child of children) {
    const raw =
      text(at(child, 'community', 'name')) ||
      text(at(child, 'subreddit', 'name')) ||
      text(at(child, 'name'));
    if (raw) names.add(normalizeSubredditName(raw));
  }
  return [...names];
}

/** Whether a comment id appears anywhere in a comments answer. */
export function containsComment(data: unknown, commentId: string): boolean {
  const wanted = commentId.toLowerCase();
  for (const object of objects(data)) {
    if (typeof object.id === 'string' && object.id.toLowerCase() === wanted) return true;
  }
  return false;
}

/** Whether the comments answer still holds the post at all. */
export function postPresent(data: unknown): boolean {
  const info = at(data, 'postInfoById');
  return isObject(info);
}
