# Decisions

Short notes on choices that are not obvious from the code. Newest at the bottom.

## Tooling

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
- **Busy subreddits calm down again.** A subreddit polled more often because it was
  busy has its interval doubled back towards the default once a poll brings in fewer
  than a quarter of a full feed.

## AI

- **Vercel AI SDK** for OpenAI, Anthropic, Google and OpenAI-compatible endpoints.
  Credentials are always passed explicitly, so the SDK never falls back to reading
  environment variables.
- **Limits are applied after parsing.** Wire schemas sent to models contain types,
  enums and required fields only. String lengths, list sizes and score ranges are
  enforced by truncating and clamping in code, because providers accept different
  subsets of JSON Schema and an over-long reason is not worth discarding an answer.
- **The daily budget is a rolling 24 hours**, which needs no time zone.
- **No default price table.** Prices change and differ by provider, so the table
  starts empty and cost shows as unknown until the user enters prices in Settings.
