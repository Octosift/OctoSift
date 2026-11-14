# Adding a new source

The pipeline reads posts through one small interface, `RedditSource` in
`src/core/reddit/types.ts`:

```ts
interface RedditSource {
  maxSubredditsPerRequest?: number;
  fetchNewPosts(subreddits: string[], opts: FetchOptions): Promise<FetchResult>;
  fetchPostWithComments?(subreddit: string, postId: string): Promise<PostThread | null>;
  checkUser?(username: string): Promise<'visible' | 'suspended' | 'missing' | 'unknown'>;
}
```

Only `fetchNewPosts` is required. It returns posts newest first, or a typed failure:

```ts
type FetchResult =
  | { ok: true; posts: RedditPost[]; rate: RateInfo; truncated?: boolean }
  | {
      ok: false;
      kind: 'blocked' | 'rate_limited' | 'gone' | 'network' | 'auth';
      retryAfterS?: number;
      message?: string;
    };
```

`FetchOptions` carries `knownIds`, to stop paging at posts already stored, and `maxPages`, used
by `pnpm cli check-source`. Set `truncated` when paging stopped at a limit before reaching older
or stored posts, so busy subreddits get read more often.

## Rules for a source

- **Never throw.** Network problems, blocks and missing communities are values. The scan
  decides what to do with them: `blocked` and `rate_limited` pause reading, `gone` marks the
  community as missing, `network` is retried on the next scan, and `auth` (an account that
  stopped working) hands the scan to the next source.
- **Return what the feed has.** Fill `RedditPost` completely: an id that is stable across
  reads, the community name in lower case, plain text with paragraph breaks, the links found in
  the body (the spam filter uses them), the creation time in epoch seconds, and `archived` when
  replies are no longer possible.
- **Keep network access in one module** and take the HTTP function, clock and limiter as
  arguments, so the source can be tested without a network. `src/core/reddit/client.ts` and
  `src/core/reddit/source.ts` (Atom feeds), and `session-client.ts` and `session.ts` (the
  connected account), are the reference: the client handles rate limits and failures; the
  source turns responses into posts. Add the new module to the lint rule's list of modules that
  may call `fetch`.
- **Respect the service's limits.** Treat rate-limit headers as the source of truth and pause
  all reads after a block rather than retrying.

## Wiring it in

`src/core/runtime.ts` builds the chain of sources used by the worker and the CLI
(`reddit/chain.ts`): the preferred source from settings first, then the others that are set up.
Add a new source there as another candidate and give it an id in `SOURCE_IDS`. Demo mode shows
the simplest pattern: it swaps the whole source for one that serves fixtures, without touching
the pipeline. The sources that exist today are described in [sources.md](sources.md).

## Testing it

`src/core/reddit/fixture.ts` turns posts into Atom feeds, and `src/core/testing/scan-harness.ts`
runs a full scan against any `RedditSource` with the fake AI provider. A new source should have
unit tests for its parsing and failure handling with a mocked HTTP function, and pass the scan
harness with its own fixtures.
