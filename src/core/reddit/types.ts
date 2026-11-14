/** Shapes shared by every way of reading Reddit. */

export interface RedditPost {
  /** Fullname, for example "t3_abc123". */
  id: string;
  /** Lower case, without the "r/" prefix. */
  subreddit: string;
  /** Without the "/u/" prefix; "[deleted]" when the author is gone. */
  author: string;
  title: string;
  /** Plain text with paragraph breaks; empty for title-only and link posts. */
  bodyText: string;
  /** Links found in the body, used to spot spam. */
  bodyLinks: string[];
  /** Permalink to the post. */
  url: string;
  imageUrl: string | null;
  /** Epoch seconds. */
  createdAt: number;
  /** Older than Reddit's archive age; replies are no longer possible. */
  archived: boolean;
  /** Signals that only some sources provide; absent or null when unknown. */
  score?: number | null;
  commentCount?: number | null;
  nsfw?: boolean;
  locked?: boolean;
  /** Removed by moderators or Reddit, even if the text is still there. */
  removed?: boolean;
  /** The body is a preview; the full post is fetched after the free filters. */
  partial?: boolean;
}

export interface RedditComment {
  /** Fullname, for example "t1_def456". */
  id: string;
  author: string;
  bodyText: string;
  url: string;
  createdAt: number;
}

export interface PostThread {
  post: RedditPost;
  comments: RedditComment[];
}

export interface SubredditRules {
  subreddit: string;
  text: string;
}

export interface RateInfo {
  used: number | null;
  remaining: number | null;
  resetS: number | null;
}

/**
 * "auth": the source's account or key no longer works and needs the user's attention.
 * "budget": a paid source stopped because the budget is spent.
 */
export type FetchFailureKind = 'blocked' | 'rate_limited' | 'gone' | 'network' | 'auth' | 'budget';

/** How a paid source asks permission to spend and reports what it spent. */
export interface SpendHooks {
  /** Null when another paid request may start, otherwise why not. */
  refuse(): string | null;
  record(costUsd: number, what: string): void;
}

export type FetchResult =
  | { ok: true; posts: RedditPost[]; rate: RateInfo }
  | { ok: false; kind: FetchFailureKind; retryAfterS?: number; message?: string };

export type UserVisibility = 'visible' | 'suspended' | 'missing' | 'unknown';

export interface FetchOptions {
  limit: number;
  /** Which of these post ids are already stored, so paging can stop early. */
  knownIds?: (ids: string[]) => Set<string>;
  spend?: SpendHooks;
  /** Read at most this many pages per subreddit, for a quick check of a source. */
  maxPages?: number;
}

export type DetailsResult =
  { ok: true; posts: RedditPost[] } | { ok: false; kind: FetchFailureKind; message: string };

/** A way of reading Reddit: Atom feeds, a connected session or a data provider. */
export interface RedditSource {
  /** How many subreddits one request may combine; the configured default when absent. */
  maxSubredditsPerRequest?: number;
  fetchNewPosts(subreddits: string[], opts: FetchOptions): Promise<FetchResult>;
  /** Full posts for ids whose listing only had a preview; for sources that mark posts partial. */
  fetchDetails?(ids: string[], opts: { spend?: SpendHooks }): Promise<DetailsResult>;
  fetchPostWithComments?(subreddit: string, postId: string): Promise<PostThread | null>;
  fetchRules?(subreddit: string): Promise<SubredditRules | null>;
  checkUser?(username: string): Promise<UserVisibility>;
}

export function normalizeSubredditName(name: string): string {
  return name
    .trim()
    .replace(/^\/?r\//i, '')
    .toLowerCase();
}
