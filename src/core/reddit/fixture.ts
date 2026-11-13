/**
 * Serves synthetic posts as Reddit-style Atom feeds, without a network.
 *
 * Demo mode and integration tests read fixtures through the real client
 * contract and the real Atom parser, so the whole read path is exercised.
 * The feeds mimic Reddit's format: the body in an `md` block between
 * SC_OFF/SC_ON markers, followed by the "submitted by" footer.
 */
import { nowSeconds, type Clock } from '../clock';
import type { FeedResponse, RedditClient } from './client';
import type { RedditPost } from './types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function iso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().replace('.000Z', '+00:00');
}

function bodyHtml(post: RedditPost): string {
  if (post.bodyText.length === 0) return '';
  const paragraphs = post.bodyText.split(/\n{2,}/).map((paragraph) => {
    let html = escapeHtml(paragraph);
    for (const link of post.bodyLinks) {
      const escaped = escapeHtml(link);
      html = html.replace(escaped, `<a href="${escaped}">${escaped}</a>`);
    }
    return `<p>${html}</p>`;
  });
  return `<!-- SC_OFF --><div class="md">${paragraphs.join('\n')}</div><!-- SC_ON -->`;
}

function entry(post: RedditPost): string {
  const author = post.author === '[deleted]' ? null : post.author;
  const footerLink = escapeHtml(post.imageUrl ?? post.url);
  const who = author
    ? `<a href="https://www.reddit.com/user/${author}"> /u/${author} </a>`
    : '[deleted]';
  const html = `${bodyHtml(post)} &#32; submitted by &#32; ${who} <br/> <span><a href="${footerLink}">[link]</a></span> &#32; <span><a href="${escapeHtml(post.url)}">[comments]</a></span>`;
  const authorXml = author
    ? `<author><name>/u/${author}</name><uri>https://www.reddit.com/user/${author}</uri></author>`
    : '';
  return [
    '<entry>',
    authorXml,
    `<category term="${post.subreddit}" label="r/${post.subreddit}"/>`,
    `<content type="html">${escapeHtml(html)}</content>`,
    `<id>${post.id}</id>`,
    `<link href="${escapeHtml(post.url)}" />`,
    `<updated>${iso(post.createdAt)}</updated>`,
    `<published>${iso(post.createdAt)}</published>`,
    `<title>${escapeHtml(post.title)}</title>`,
    '</entry>',
  ].join('');
}

export function buildAtomFeed(title: string, posts: RedditPost[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">',
    `<title>${escapeHtml(title)}</title>`,
    ...posts.map(entry),
    '</feed>',
  ].join('');
}

const NOT_FOUND =
  '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>reddit.com: page not found</title></feed>';

const LISTING_PATH = /^\/r\/([a-z0-9_+]+)\/new\/\.rss\?limit=(\d+)$/;
const THREAD_PATH = /^\/r\/([a-z0-9_]+)\/comments\/([a-z0-9]+)\/\.rss$/;

/**
 * A RedditClient that answers feed paths from a list of posts. Unknown
 * subreddits get Reddit's "page not found" feed.
 */
export function createFixtureClient(options: {
  posts: () => RedditPost[];
  clock: Clock;
  /** Subreddits that exist even when they have no posts. */
  subreddits?: () => string[];
}): RedditClient & { paths: string[] } {
  const paths: string[] = [];
  const rate = { used: 1, remaining: 99, resetS: 60 };
  return {
    paths,
    getFeed(path: string): Promise<FeedResponse> {
      paths.push(path);
      const all = options.posts().filter((post) => post.createdAt <= nowSeconds(options.clock));
      const known = new Set([
        ...(options.subreddits?.() ?? []),
        ...all.map((post) => post.subreddit),
      ]);
      const listing = LISTING_PATH.exec(path);
      if (listing) {
        const names = (listing[1] ?? '').split('+');
        if (!names.every((name) => known.has(name))) {
          return Promise.resolve({ ok: true, body: NOT_FOUND, rate });
        }
        const selected = all
          .filter((post) => names.includes(post.subreddit))
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
          .slice(0, Number(listing[2]));
        const body = buildAtomFeed(`newest : ${names.join('+')}`, selected);
        return Promise.resolve({ ok: true, body, rate });
      }
      const thread = THREAD_PATH.exec(path);
      if (thread) {
        const post = all.find((candidate) => candidate.id === `t3_${thread[2] ?? ''}`);
        return Promise.resolve({ ok: true, body: buildAtomFeed('post', post ? [post] : []), rate });
      }
      return Promise.resolve({ ok: false, kind: 'gone', message: 'Unknown fixture path' });
    },
  };
}
