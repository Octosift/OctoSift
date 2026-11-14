# Data sources

Octosift reads Reddit through one of three sources. Settings → Data source picks the
preferred one; with failover on, the others that are set up follow in this order.

| Source           | Cost        | Needs                         | Reads per subreddit                                        |
| ---------------- | ----------- | ----------------------------- | ---------------------------------------------------------- |
| Reddit account   | free        | a connected account's session | up to three hot pages, plus the day's top for busy ones    |
| Data provider    | per request | an adapter's API key          | one to three feed pages, then full posts for the survivors |
| Public RSS feeds | free        | nothing                       | one feed, shared by up to five quiet subreddits            |

`pnpm cli check-source [subreddit]` makes one request with the configured source and prints
which source answered and how many posts came back.

## Reddit account

Reads `/r/<subreddit>.json` with the stored session cookie. Reddit refuses the newest-first
listing to these sessions, so the hot listing is read instead; three pages cover the newest
posts of most subreddits, and a subreddit whose three hot pages are all from the last day also
gets `/top.json?t=day`. Requests go one at a time, at least eight seconds apart, at most 120 an
hour. A refused session, a redirect to the sign-in page or a page that is not JSON marks the
account as needing reconnection; reads stop and a banner says so.

The cookie is stored encrypted, only ever sent to `www.reddit.com`, and never logged.

## Data providers

A provider lists a subreddit's newest posts with short previews. A scan reads the feed pages,
runs the free filters on the previews, and fetches full posts for the survivors in batches. Only
successful requests are billed by the providers below, and every billed request is recorded in
the usage ledger and counted against the budget caps.

| Adapter | Key setting      | Feed                                                     | Full posts                                        | Other uses                                                                            |
| ------- | ---------------- | -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Vendor  | `VENDOR_API_KEY` | `subreddit_feed` (`sort=NEW`), 6 to 8 posts a page | `post_details_batch`, up to 30 a call | community search (`community_search`); comment visibility (`post_comments`) |

Default price: $0.001 a request, editable in Settings.

### Adding an adapter

An adapter is a client (`src/core/reddit/provider/vendor.ts` is the reference: authentication,
its own limiter, retries, and the mapping of the provider's errors to the usual failure kinds)
and readers that turn its answers into `RedditPost` values (`vendor-parse.ts`). The provider
source in `provider/source.ts` does the paging, the batching and the spending; it only needs
the client and the readers. Test both with synthetic answers in the provider's response shapes,
as in `fixtures/provider/`.

## Public RSS feeds

The logged-out Atom feeds, `/r/<subreddit>/new/.rss`. Reddit ended support for them in late
2026; they still answered when this was written but may stop at any time, so they are a
best-effort fallback. See [how logged-out reads behave](reddit-reads.md).
