/**
 * Suggests subreddits for a product and checks that they exist.
 *
 * Validation reads each subreddit's feed through the normal Reddit source,
 * so it obeys the same rate limit as scans. That makes it slow (about a
 * minute per subreddit when logged out), which is why it reports progress
 * and stops as soon as Reddit blocks a request.
 */
import type { AiClient } from '../ai/client';
import { buildSubredditSuggestionPrompt } from '../ai/prompts/subreddits';
import {
  normalizeSubredditSuggestions,
  subredditSuggestionsWire,
  type SubredditSuggestion,
} from '../ai/schemas';
import { CONFIG } from '../config';
import type { ProductProfile } from './types';
import { normalizeSubredditName, type RedditPost, type RedditSource } from '../reddit/types';

export type SuggestResult =
  { ok: true; suggestions: SubredditSuggestion[] } | { ok: false; message: string };

export async function suggestSubreddits(
  ai: AiClient,
  profile: ProductProfile,
): Promise<SuggestResult> {
  const max = CONFIG.subreddits.maxSuggestions;
  const { system, prompt } = buildSubredditSuggestionPrompt(profile, max);
  const result = await ai.object({
    task: 'subreddits',
    system,
    prompt,
    schema: subredditSuggestionsWire,
    subject: { productName: profile.name },
  });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, suggestions: normalizeSubredditSuggestions(result.value, max) };
}

const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;

/** Posts per day implied by a feed, rounded to one decimal place. */
export function estimatePostsPerDay(posts: RedditPost[], now: number): number {
  if (posts.length === 0) return 0;
  const oldest = Math.min(...posts.map((post) => post.createdAt));
  const spanS = Math.max(HOUR_S, now - oldest);
  return Math.round((posts.length / (spanS / DAY_S)) * 10) / 10;
}

export type SubredditCheck =
  | { name: string; status: 'ok'; postsPerDay: number }
  | { name: string; status: 'gone' }
  | { name: string; status: 'unavailable'; message: string; retryAfterS?: number };

export async function validateSubreddit(
  source: RedditSource,
  rawName: string,
  now: number,
): Promise<SubredditCheck> {
  const name = normalizeSubredditName(rawName);
  const result = await source.fetchNewPosts([name], { limit: CONFIG.reddit.feedLimit });
  if (result.ok) return { name, status: 'ok', postsPerDay: estimatePostsPerDay(result.posts, now) };
  if (result.kind === 'gone') return { name, status: 'gone' };
  const message = result.message ?? 'Reddit could not be read right now';
  return result.retryAfterS === undefined
    ? { name, status: 'unavailable', message }
    : { name, status: 'unavailable', message, retryAfterS: result.retryAfterS };
}

export async function validateSubreddits(
  source: RedditSource,
  names: string[],
  now: number,
  onProgress?: (done: number, total: number) => void,
): Promise<SubredditCheck[]> {
  const results: SubredditCheck[] = [];
  for (const [index, rawName] of names.entries()) {
    const check = await validateSubreddit(source, rawName, now);
    results.push(check);
    onProgress?.(index + 1, names.length);
    if (check.status === 'unavailable' && check.retryAfterS !== undefined) {
      // Reads are paused; do not spend the remaining names on certain failures.
      for (const rest of names.slice(index + 1)) {
        results.push({
          name: normalizeSubredditName(rest),
          status: 'unavailable',
          message: check.message,
          retryAfterS: check.retryAfterS,
        });
      }
      break;
    }
  }
  return results;
}
