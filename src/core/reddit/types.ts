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

export type FetchFailureKind = 'blocked' | 'rate_limited' | 'gone' | 'network';

export type FetchResult =
  | { ok: true; posts: RedditPost[]; rate: RateInfo }
  | { ok: false; kind: FetchFailureKind; retryAfterS?: number; message?: string };

export type UserVisibility = 'visible' | 'suspended' | 'missing' | 'unknown';

/** A way of reading Reddit. Atom feeds are the default; other sources can be added. */
export interface RedditSource {
  fetchNewPosts(subreddits: string[], opts: { limit: number }): Promise<FetchResult>;
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
