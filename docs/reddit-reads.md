# How logged-out Reddit reads behave

These notes cover the public RSS feeds, now the best-effort fallback source: Reddit ended RSS
support in late 2026. The default is a connected Reddit account; see [sources.md](sources.md).

Checked on 2026-11-13 from a residential connection without logging in, using a
desktop browser User-Agent and `Accept: application/atom+xml`. Eight requests in
total. Only status codes, headers and element names were recorded; no post
content was kept.

## Results

| Request                                              | Status | Notes                                                                                                                                |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/r/AskReddit/new/.rss?limit=100`                    | 200    | Atom feed, 100 entries, all ids `t3_…`                                                                                               |
| `/r/AskReddit+books+technology/new/.rss?limit=100`   | 200    | Combined feed works: 100 entries, entries from more than one subreddit, each tagged with its own `category`                          |
| `/r/<sub>/comments/<id>/.rss`                        | 200    | Atom feed; the first entry is the post itself (`t3_…`). The post read had no comments yet, so comment entries were not observed here |
| `/user/<name>/.rss` (a long-standing public account) | 200    | Atom feed with posts (`t3_…`) and comments (`t1_…`)                                                                                  |
| `/r/<name that does not exist>/new/.rss`             | 302    | Redirect, not a "page not found" feed                                                                                                |
| Requests sent 16 s after a previous one              | 429    | Empty body, rate-limit headers present                                                                                               |

### Entry fields

`id`, `title`, `link`, `author` (with `name` and `uri`), `category` (subreddit),
`content` (HTML), `published`, `updated`, and `media:thumbnail` on entries that
have a preview image.

The `content` HTML of a text post wraps the body in
`<!-- SC_OFF --><div class="md">…</div><!-- SC_ON -->` and ends with a footer
containing "submitted by", `[link]` and `[comments]`. Title-only posts have the
footer but no `md` block.

Feed-level elements: `feed`, `title`, `id`, `updated`, `link`, `category`, and on
single-subreddit feeds `icon`, `logo` and `subtitle`.

## Rate limiting

Every response carried `x-ratelimit-used`, `x-ratelimit-remaining` and
`x-ratelimit-reset`. After a single request the headers read `used: 1`,
`remaining: 0.0` and `reset` between 21 and 55 seconds, and the next request
inside that window was answered with HTTP 429.

In practice the logged-out budget was **one request per rate-limit window,
roughly one per minute**, which is tighter than one every ten seconds. The client
therefore treats the headers as the source of truth: when `remaining` drops below
one, it waits `reset` seconds before the next request. The fixed minimum spacing
is only a floor for when the headers are missing.

## Consequences for the design

- One request per subreddit per scan is the right shape: a single feed request
  returns up to 100 posts with full bodies.
- Combined feeds matter more than expected, because each request is expensive in
  wall-clock time. Quiet subreddits are grouped, up to five per request.
- A missing subreddit is detected by a redirect to anything other than a login
  page, in addition to the "page not found" feed described in older reports. A
  redirect to a login page is still treated as a block.
- Validating a list of suggested subreddits takes about a minute per subreddit,
  so validation runs in the background with visible progress.
- `.json` endpoints were not used. They are reported to be blocked for logged-out
  clients and nothing here depends on them.
