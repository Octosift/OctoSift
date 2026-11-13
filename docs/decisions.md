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
- **No Reddit app credentials.** Reddit closed self-service API access in November 2025 and
  stopped accepting new access requests at the end of October 2026, so new users cannot get
  credentials for an app-only source. Subreddit rules are pasted by the user instead and
  summarised once; the summary sets the promotion policy only while the user has not chosen
  one.
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

## Pipeline

- **The unverified-quote penalty is applied once**, in the score stage, rather than both
  when the quote is checked and again in the score.
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
  website with a model, so the provider has to be set up before the product step.
- **Sessions expire and wrong passwords are throttled.** The session cookie holds its issue
  time and an HMAC keyed by an scrypt hash of `APP_PASSWORD`, and lasts 30 days. After ten
  wrong passwords in a minute, sign-ins pause for everyone until the minute has passed, so a
  long random password is still the main defence.
- **Next.js is pinned to the project folder** (Turbopack root) and does not write its agent
  instruction file into the repository.
