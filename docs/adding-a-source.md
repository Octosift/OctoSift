# Adding a new source

The pipeline reads posts through one small interface, `RedditSource` in
`src/core/reddit/types.ts`:

```ts
interface RedditSource {
  fetchNewPosts(subreddits: string[], opts: { limit: number }): Promise<FetchResult>;
  fetchPostWithComments?(subreddit: string, postId: string): Promise<PostThread | null>;
  fetchRules?(subreddit: string): Promise<SubredditRules | null>;
  checkUser?(username: string): Promise<'visible' | 'suspended' | 'missing' | 'unknown'>;
}
```

Only `fetchNewPosts` is required. It returns posts newest first, or a typed failure:

```ts
type FetchResult =
  | { ok: true; posts: RedditPost[]; rate: RateInfo }
  | { ok: false; kind: 'blocked' | 'rate_limited' | 'gone' | 'network'; retryAfterS?: number };
```

## Rules for a source

- **Never throw.** Network problems, blocks and missing communities are values. The scan
  decides what to do with them: `blocked` and `rate_limited` pause reading, `gone` marks the
  community as missing, `network` is retried on the next scan.
- **Return what the feed has.** Fill `RedditPost` completely: an id that is stable across
  reads, the community name in lower case, plain text with paragraph breaks, the links found in
  the body (the spam filter uses them), the creation time in epoch seconds, and `archived` when
  replies are no longer possible.
- **Keep network access in one module** and take the HTTP function, clock and limiter as
  arguments, so the source can be tested without a network. `src/core/reddit/client.ts` and
  `src/core/reddit/source.ts` are the reference: the client handles rate limits, retries and
  caching; the source turns responses into posts.
- **Respect the service's limits.** Treat rate-limit headers as the source of truth and pause
  all reads after a block rather than retrying.

## Wiring it in

`src/core/runtime.ts` builds the source used by the worker and the CLI. Replace the Atom source
there (or choose between sources from a setting). Demo mode shows the pattern: it swaps the
source for one that serves fixtures, without touching the pipeline.

## Testing it

`src/core/reddit/fixture.ts` turns posts into Atom feeds, and `src/core/testing/scan-harness.ts`
runs a full scan against any `RedditSource` with the fake AI provider. A new source should have
unit tests for its parsing and failure handling with a mocked HTTP function, and pass the scan
harness with its own fixtures.
