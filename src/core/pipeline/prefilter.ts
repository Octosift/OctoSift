/**
 * Cheap, deterministic checks that run before any AI call.
 *
 * Every skip carries a named reason so the funnel can explain itself. Posts
 * that mention the product by name or domain are kept and tagged as brand
 * mentions, even when a topical rule would have skipped them: the founder
 * wants to see those regardless. Rules about whether a reply is possible at
 * all (removed posts, own posts, bots) still apply to them.
 */
import { franc } from 'franc-min';
import { CONFIG } from '../config';
import type { RedditPost } from '../reddit/types';

export type PrefilterReason =
  | 'too_old'
  | 'removed'
  | 'empty'
  | 'profile_post'
  | 'own_post'
  | 'bot_author'
  | 'blocked_subreddit'
  | 'blocked_term'
  | 'spam_links'
  | 'language'
  | 'crosspost';

export type PrefilterVerdict =
  | { verdict: 'pass'; brandMention: boolean }
  | { verdict: 'skip'; reason: PrefilterReason; detail: string };

export interface PrefilterContext {
  now: number;
  maxPostAgeHours: number;
  ownUsername: string | null;
  blocklist: { subreddits: readonly string[]; terms: readonly string[] };
  /** Two-letter language codes the product supports. */
  languages: readonly string[];
  /** The product's name and domain. */
  brandTerms: readonly string[];
  detectLanguage: (text: string) => string | null;
}

/** franc reports ISO 639-3 codes; settings use the two-letter ISO 639-1 codes. */
const ISO_639_3_TO_1: Record<string, string> = {
  eng: 'en',
  spa: 'es',
  fra: 'fr',
  deu: 'de',
  por: 'pt',
  ita: 'it',
  nld: 'nl',
  pol: 'pl',
  tur: 'tr',
  rus: 'ru',
  ukr: 'uk',
  ron: 'ro',
  ind: 'id',
  vie: 'vi',
  jpn: 'ja',
  kor: 'ko',
  cmn: 'zh',
  hin: 'hi',
  arb: 'ar',
  swe: 'sv',
  ces: 'cs',
  hun: 'hu',
};

/** Returns a two-letter language code, or null when the text is too short or unclear. */
export function detectLanguage(text: string): string | null {
  if (text.trim().length < CONFIG.prefilter.minCharsForLanguageCheck) return null;
  return ISO_639_3_TO_1[franc(text)] ?? null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive match on word boundaries, so short terms do not match inside words. */
export function containsTerm(text: string, term: string): boolean {
  const trimmed = term.trim();
  if (trimmed.length === 0) return false;
  const pattern = escapeRegExp(trimmed).replace(/\s+/g, '[\\s-]+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

function isAllowedHost(link: string): boolean {
  let host: string;
  try {
    host = new URL(link).hostname.toLowerCase();
  } catch {
    // Relative or malformed links point nowhere outside Reddit.
    return true;
  }
  return CONFIG.prefilter.linkAllowlist.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

function isBot(author: string): boolean {
  const name = author.toLowerCase();
  return CONFIG.prefilter.knownBots.includes(name) || name.endsWith('bot');
}

const skip = (reason: PrefilterReason, detail: string): PrefilterVerdict => ({
  verdict: 'skip',
  reason,
  detail,
});

export function prefilter(post: RedditPost, context: PrefilterContext): PrefilterVerdict {
  const body = post.bodyText.trim();
  const text = `${post.title}\n${body}`;

  if (body === '[removed]' || body === '[deleted]') return skip('removed', `Body is ${body}`);
  if (post.subreddit.startsWith('u_')) return skip('profile_post', 'Posted on a user profile');
  if (
    context.ownUsername !== null &&
    post.author.toLowerCase() === context.ownUsername.toLowerCase()
  ) {
    return skip('own_post', 'Your own post');
  }
  if (isBot(post.author)) return skip('bot_author', `Posted by ${post.author}`);

  if (context.brandTerms.some((term) => containsTerm(text, term))) {
    return { verdict: 'pass', brandMention: true };
  }

  const ageHours = (context.now - post.createdAt) / 3600;
  if (ageHours > context.maxPostAgeHours) {
    return skip('too_old', `Older than ${context.maxPostAgeHours} hours`);
  }
  if (body.length === 0 && post.imageUrl === null) return skip('empty', 'No text and no image');
  if (context.blocklist.subreddits.includes(post.subreddit)) {
    return skip('blocked_subreddit', `r/${post.subreddit} is on your blocklist`);
  }
  const term = context.blocklist.terms.find((candidate) => containsTerm(text, candidate));
  if (term !== undefined) return skip('blocked_term', `Contains "${term}"`);
  const external = post.bodyLinks.filter((link) => !isAllowedHost(link));
  if (external.length > CONFIG.prefilter.maxExternalLinks) {
    return skip('spam_links', `${external.length} links to unknown sites`);
  }
  const language = context.detectLanguage(text);
  if (language !== null && !context.languages.includes(language)) {
    return skip('language', `Written in ${language}`);
  }
  return { verdict: 'pass', brandMention: false };
}
