# Decisions

Short notes on choices that are not obvious from the code. Newest at the bottom.

## Tooling

- **Node.js 22.12+, 24 or 26.** The test runner accepts only these long-term support lines
  (22 from 22.12), and the SQLite driver and AI SDK need 22 or later. 24 is the default in
  `.nvmrc` and the Docker image. Node 26 has no prebuilt SQLite binary yet, so it compiles
  during install. CI runs the checks on all three.

- **TypeScript 6.0, not 7.** The native TypeScript 7 compiler is not yet supported by
  typescript-eslint.
- **ESLint 9, not 10.** The React, accessibility and import plugins used by Next.js do
  not declare support for ESLint 10 yet.
- **Prettier runs as part of `pnpm lint`** so formatting drift fails the same gate as
  lint errors.

## Storage

- **better-sqlite3 with Drizzle.** Synchronous access keeps query functions simple and
  fast for a single-user local app; WAL mode lets the worker and the dashboard share
  one file.
- **Migrations are resolved from the working directory**, not from the module's own
  location, because the Next.js server build moves compiled modules away from their
  sources.

## Reddit

- **fast-xml-parser** for Atom feeds. Documents that declare a DTD are refused before
  parsing, so entity expansion is impossible whatever the parser settings.
- **linkedom** to turn the HTML inside feed entries into text. It is small, has no
  native parts, and also provides the DOM that the readability library needs for
  crawling product pages.
- **undici** only for proxied requests: its `ProxyAgent` gives each request a fresh
  connection, so a rotating proxy can change the exit address. Unproxied requests use
  the built-in `fetch`.
- **Rate-limit headers win over fixed spacing.** In testing the logged-out budget was
  about one request per minute, so the client waits for `x-ratelimit-reset` whenever
  the remaining budget drops below one. See `reddit-reads.md`.
- **Reddit is read by one process at a time.** The worker and the CLI scan (which
  takes the same scan lock) are the only readers, so one in-process limiter is enough.
- **No Reddit app credentials.** Reddit stopped accepting new public API requests after
  October 31, 2026 and ends the public Data API in March 2027 (announced September 30, 2026),
  so new users cannot get credentials for an app-only source. Subreddit rules are pasted by the user instead and summarised once; the
  summary sets the promotion policy only while the user has not chosen one.
- **Two sources, tried in order.** Reddit retired its public RSS feeds on November 13, 2026
  and is closing its public Data API, so RSS is kept only as a best-effort fallback. The default is a Reddit
  account the user connects. The preferred source goes first and, with failover on, a source
  whose account stops working hands the rest of the scan to the other one. See `sources.md`.
- **No paid data source.** The open-source app does not ship one: it would add a vendor, a key
  and a bill to a tool meant to run for free on the user's machine. The `RedditSource`
  interface stays, so a source can be added later without touching the pipeline.
- **The session reads the hot listing.** Reddit refuses the newest-first listing to signed-in
  sessions too. Paging stops after a page that reaches a post older than the age limit or one
  already stored, rather than at the first such post, because hot pages are not in time order.
- **Signing in happens in a real browser window.** The user signs in on Reddit's own page and
  the app only takes the cookies afterwards, so it never handles the password. A pasted cookie
  is the fallback where no window can open. Either is checked with one request to
  `/api/me.json` before saving: a signed-in session answers with the account's name, a
  signed-out one with an empty object, so the check also gives the name to show.
- **A refusal is about the session unless it names a subreddit.** A 401, a 403 or a redirect
  to the sign-in page marks the session for reconnecting. A 403 whose JSON names a private,
  banned or quarantined subreddit is about that subreddit, so reading the others goes on.
- **A source that runs out of pages counts as busy.** Busy subreddits are read more often when a
  read stops at its page limit before reaching older posts, not only when a feed is full.
- **Reply checks read the comment's own permalink.** Scanning a post's newest comments misses
  replies in busy threads; the permalink thread always contains the comment unless it was
  removed. The checks use the connected session, so they share its pace and hourly cap with
  scans and run a few per minute at most. Only a refusal or a sign-in redirect marks the session;
  other failures are retried twice and then reported as "could not tell".
- **A reply from the connected account cannot be judged.** Reddit shows authors their own
  removed comments as if nothing happened, so such a check says it could not tell rather than
  "visible". The settings and the reply dialog advise replying from another account.
- **The profile check is confirmed before it warns.** The connected account's
  `/user/<name>/about.json` is read daily; `is_suspended` means suspended and a 404 means
  shadowbanned or deleted. One bad answer may be a glitch, so it is read again after half an
  hour and only a repeat raises the warning.
- **Busy subreddits calm down again.** A subreddit polled more often because it was
  busy has its interval doubled back towards the default once a poll brings in fewer
  than a quarter of a full feed.

## Image posts

- **Only images hosted by Reddit are described.** Other image hosts would mean contacting a site
  outside Reddit and the AI provider, directly or through the AI SDK.
- **One failure stops image descriptions for the scan.** The setting cannot know whether the
  model accepts images; stopping after the first failure keeps a wrong guess to one call and
  keeps it from tripping the AI failure guard.

## Evergreen threads

- **DataForSEO's live endpoint, not the task queue.** The queue costs less per search but needs
  polling for results; a weekly check of at most 20 keywords costs about $0.08 live, and the
  user sees the results at once when pressing Check now.
- **The cost shown is the one DataForSEO reports**, summed over the keywords of a check, not an
  estimate.
- **Archived threads are listed, not hidden.** Threads past Reddit's archive age (about six
  months) are greyed and labelled, because they show what ranks even though they take no new
  replies. The tab's count leaves them out.
- **Checks do not take the scan lock.** They read Google results, not Reddit, so they do not
  compete for Reddit's rate limit.

## AI

- **Vercel AI SDK** for OpenAI, Anthropic and OpenAI-compatible endpoints.
  Credentials are always passed explicitly, so the SDK never falls back to reading
  environment variables.
- **Limits are applied after parsing.** Wire schemas sent to models contain types,
  enums and required fields only. String lengths, list sizes and score ranges are
  enforced by truncating and clamping in code, because providers accept different
  subsets of JSON Schema and an over-long reason is not worth discarding an answer.
- **The daily budget is a rolling 24 hours**, which needs no time zone.
- **Presets instead of model ids.** Onboarding asks for one key and one of three presets;
  `src/core/ai/presets.ts` maps each to recommended models, taken from the providers' model and
  pricing pages and dated in the file. Saving a key fetches the models it can use, and presets
  it cannot use are hidden. Per-stage models, custom ids and OpenAI-compatible endpoints stay
  under Advanced in Settings.
- **Prices come with the preset.** Choosing a preset adds the list prices of its models to the
  price table, so scans have a cost from the start; prices the user entered are never replaced.
  Models chosen by hand have no price until the user adds one, and count as unknown.
- **Only OpenAI and Anthropic in onboarding.** Fewer choices make the first step quicker;
  OpenAI-compatible endpoints are for people running local models and live under Advanced.
- **An experimental CLI provider, off by default.** With `EXPERIMENTAL_CLI_PROVIDERS=1`, the
  Codex CLI can run the pipeline on a ChatGPT sign-in. Each call runs `codex exec` in an empty
  temporary folder, with the user's Codex config and rules ignored, a read-only sandbox, stdin
  closed and no API keys passed on, one call at a time and killed after 180 seconds. Every call
  carries about 18,000 tokens of the CLI's own instructions, so triage sends 25 posts per call
  and qualify five. Calls cost nothing per token; the ledger records what the same tokens would
  cost on the API, and the Runs screen reports it. Its stderr is never logged, only a scrubbed
  one-line summary. It is meant for measuring costs, not for the first release.

## Pipeline

- **The unverified-quote penalty is applied once**, in the score stage, rather than both
  when the quote is checked and again in the score.
- **Busy threads score a little lower.** When the source reports comment counts, a thread with
  100 or more comments loses 5 points, because a late reply there is rarely seen.
- **Language is only judged for posts of 80 characters or more.** Detection on short text
  misread English as other languages in testing, which would silently drop leads.
- **Private-message drafts are automatic by default**: off for consumer products, on for
  others. The founder can switch them on or off per product.
- **The crawler and the webhook may call `fetch`** besides the Reddit client and the AI
  provider: reading the product's own site and posting to the founder's webhook are network
  calls by design.
- **The crawler only reads public addresses.** Every request, redirects included, is
  checked against loopback, private and link-local ranges, and no page is read past 2 MB.
  The host is resolved just before each request, so this does not defend against DNS
  rebinding; it stops the dashboard from being pointed at its own machine or network.

## Processes

- **The dashboard never reads Reddit.** Subreddit checks and "scan now" are requests the
  worker carries out, so every Reddit read shares one rate limiter.
- **A scan that loses its lock stops.** If another process takes the lock over, the scan
  stops reading Reddit and calling models, and the run ends as partial with the reason.
  Subreddit checks keep the lock alive with the same heartbeat as scans.
- **Migrations run once before the processes start**, so the dashboard and the worker never
  race to apply them.
- **tsx and concurrently are runtime dependencies**, because the worker runs from TypeScript
  source and `pnpm start` runs both processes.

## Dashboard

- **shadcn/ui as an approach, not a generator.** The components are small local files on
  Radix primitives and Tailwind tokens, written the shadcn way, with one accent colour.
- **Onboarding connects the AI provider first.** The product profile is built from the
  website with a model, so the provider has to be set up before the product step. It is the
  only required step: the others can be skipped, and skipping the product step ends onboarding
  on an inbox that asks for a product.
- **Fewer inputs.** The product step fills in the profile from the crawl and keeps the
  interview questions folded away as optional; the top five subreddit suggestions come ticked;
  each step has one primary button.
- **Connecting a Reddit account comes next, and can be skipped.** Subreddit validation and the
  first scan are much faster with an account, so it is offered before the product step. Skipping
  is allowed, with a note that the app then reads the public feeds Reddit is retiring; the
  progress bar shows the step as skipped rather than done, and a fresh setup still opens on it.
- **Sessions expire and wrong passwords are throttled.** The session cookie holds its issue
  time and an HMAC keyed by an scrypt hash of `APP_PASSWORD`, and lasts 30 days. After ten
  wrong passwords in a minute, sign-ins pause for everyone until the minute has passed, so a
  long random password is still the main defence.
- **Next.js is pinned to the project folder** (Turbopack root) and does not write its agent
  instruction file into the repository.
