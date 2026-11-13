/**
 * Parses Reddit's Atom feeds into posts and comments.
 *
 * Feeds are untrusted input. Documents that declare a DTD or entities are
 * refused outright, which rules out entity-expansion attacks regardless of
 * parser settings. Each entry is validated; entries that do not match the
 * expected shape are skipped rather than failing the whole feed.
 */
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { CONFIG } from '../config';
import { isImageUrl, readEntryHtml } from './html';
import {
  normalizeSubredditName,
  type PostThread,
  type RedditComment,
  type RedditPost,
} from './types';

export type FeedParseResult =
  | { kind: 'posts'; posts: RedditPost[] }
  | { kind: 'not_found' }
  | { kind: 'invalid'; reason: string };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === 'entry',
});

const text = z.union([
  z.string(),
  z.object({ '#text': z.string().optional() }).transform((node) => node['#text'] ?? ''),
]);
const oneOrMany = <T extends z.ZodType>(schema: T) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]));

const entrySchema = z.object({
  id: z.string().regex(/^t[13]_[a-z0-9]+$/i),
  title: text.optional(),
  link: oneOrMany(z.object({ href: z.string(), rel: z.string().optional() })),
  author: z.object({ name: z.string() }).optional(),
  category: oneOrMany(z.object({ term: z.string() })),
  content: text.optional(),
  published: z.string(),
});
type Entry = z.output<typeof entrySchema>;

const feedSchema = z.object({
  feed: z.object({
    title: text.optional(),
    entry: z.array(z.unknown()).optional(),
  }),
});

function parseDocument(
  xml: string,
): { ok: true; title: string; entries: Entry[] } | { ok: false; reason: string } {
  if (/<!(DOCTYPE|ENTITY)/i.test(xml)) {
    return { ok: false, reason: 'Feeds with document type declarations are not accepted' };
  }
  let raw: unknown;
  try {
    raw = parser.parse(xml);
  } catch (error) {
    return {
      ok: false,
      reason: `Malformed XML: ${error instanceof Error ? error.message : 'unknown'}`,
    };
  }
  const feed = feedSchema.safeParse(raw);
  if (!feed.success) return { ok: false, reason: 'Not an Atom feed' };
  const entries: Entry[] = [];
  for (const candidate of feed.data.feed.entry ?? []) {
    const entry = entrySchema.safeParse(candidate);
    if (entry.success) entries.push(entry.data);
  }
  return { ok: true, title: feed.data.feed.title ?? '', entries };
}

function epochSeconds(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function authorName(entry: Entry): string {
  const name = entry.author?.name.replace(/^\/?u\//, '').trim();
  return name !== undefined && name.length > 0 ? name : '[deleted]';
}

function permalink(entry: Entry): string {
  const alternate = entry.link.find((link) => link.rel === undefined || link.rel === 'alternate');
  return alternate?.href ?? entry.link[0]?.href ?? '';
}

function capBody(body: string): string {
  if (body.length <= CONFIG.reddit.maxBodyChars) return body;
  return `${body.slice(0, CONFIG.reddit.maxBodyChars).trimEnd()}\n\n[truncated]`;
}

function toPost(entry: Entry, now: number): RedditPost | null {
  const createdAt = epochSeconds(entry.published);
  const subreddit = entry.category[0]?.term;
  if (createdAt === null || subreddit === undefined || !entry.id.startsWith('t3_')) return null;
  const html = readEntryHtml(entry.content ?? '');
  const imageCandidates = [html.footerLink, ...html.bodyLinks].filter(
    (link): link is string => link !== null,
  );
  return {
    id: entry.id,
    subreddit: normalizeSubredditName(subreddit),
    author: authorName(entry),
    title: (entry.title ?? '').trim(),
    bodyText: capBody(html.bodyText),
    bodyLinks: html.bodyLinks,
    url: permalink(entry),
    imageUrl: imageCandidates.find(isImageUrl) ?? null,
    createdAt,
    archived: now - createdAt > CONFIG.reddit.archiveAfterS,
  };
}

function toComment(entry: Entry): RedditComment | null {
  const createdAt = epochSeconds(entry.published);
  if (createdAt === null || !entry.id.startsWith('t1_')) return null;
  return {
    id: entry.id,
    author: authorName(entry),
    bodyText: capBody(readEntryHtml(entry.content ?? '').bodyText),
    url: permalink(entry),
    createdAt,
  };
}

export function parseFeed(xml: string, { now }: { now: number }): FeedParseResult {
  const document = parseDocument(xml);
  if (!document.ok) return { kind: 'invalid', reason: document.reason };
  if (document.entries.length === 0 && /page not found/i.test(document.title)) {
    return { kind: 'not_found' };
  }
  const posts = document.entries
    .map((entry) => toPost(entry, now))
    .filter((post): post is RedditPost => post !== null);
  return { kind: 'posts', posts };
}

/** Parses the feed of a single post: the post first, then its comments. */
export function parseThreadFeed(xml: string, { now }: { now: number }): PostThread | null {
  const document = parseDocument(xml);
  if (!document.ok) return null;
  const postEntry = document.entries.find((entry) => entry.id.startsWith('t3_'));
  const post = postEntry ? toPost(postEntry, now) : null;
  if (!post) return null;
  const comments = document.entries
    .map(toComment)
    .filter((comment): comment is RedditComment => comment !== null);
  return { post, comments };
}
