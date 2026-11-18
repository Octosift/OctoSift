# Data sources

Octosift reads Reddit through one of two sources, plus synthetic fixtures in demo mode.
Settings → Data source picks the preferred one; with failover on, the other follows when it is
set up.

| Source           | Needs                         | Reads per subreddit                                     |
| ---------------- | ----------------------------- | ------------------------------------------------------- |
| Reddit account   | a connected account's session | up to three hot pages, plus the day's top for busy ones |
| Public RSS feeds | nothing                       | one feed, shared by up to five quiet subreddits         |
| Demo fixtures    | demo mode                     | synthetic posts from `fixtures/demo/`                   |

Both real sources are free. `pnpm cli check-source [subreddit]` makes one request with the
configured source and prints which source answered and how many posts came back.

## Reddit account

Reads `/r/<subreddit>.json` with the stored session cookie. Reddit refuses the newest-first
listing to these sessions, so the hot listing is read instead; three pages cover the newest
posts of most subreddits, and a subreddit whose three hot pages are all from the last day also
gets `/top.json?t=day`. Requests go one at a time, at least eight seconds apart, at most 120 an
hour. A refused session, a redirect to the sign-in page or a page that is not JSON marks the
account as needing reconnection; reads stop and a banner says so. A refusal that names a
private, banned or quarantined subreddit only marks that subreddit.

Connecting makes one request to `/api/me.json`, which names the signed-in account and so proves
the session works. The cookie is stored encrypted, only ever sent to `www.reddit.com`, and never
logged.

### Checks made with the account

The same session, pace and hourly cap serve two checks. Neither marks the session for
reconnecting unless Reddit refuses it (401 or 403) or redirects to the sign-in page.

- **Reply checks.** When you mark a lead as replied and paste your comment's link, the app reads
  that permalink plus `.json` an hour and a day later. The answer is the comment's own thread:
  the comment is there (visible), shows `[removed]` or `[deleted]` or is missing (removed), or
  the post itself was removed or deleted (post gone). Reddit shows authors their own removed
  comments, so a reply posted from the connected account is reported as "could not tell"; post
  from a different account. A check that cannot run is tried twice more, half an hour apart.
- **Profile check.** Once a day the app reads `/user/<name>/about.json` for the connected
  account. `is_suspended` means suspended; a 404 means the account is shadowbanned or deleted.
  A bad result is read again half an hour later, and only a repeat raises a warning.

## Public RSS feeds

The logged-out Atom feeds, `/r/<subreddit>/new/.rss`. Reddit retired them on November 13, 2026
(announced September 30, 2026); they still answered when this was written but may return nothing or stop at any time, so
they are a best-effort fallback. See [how logged-out reads behave](reddit-reads.md).

## Adding a source

Every source implements `RedditSource`; see [adding a new source](adding-a-source.md).
