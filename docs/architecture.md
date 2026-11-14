# Architecture

One TypeScript repository with three entry points over one library.

```
src/
  core/      the library: Reddit, AI, pipeline, storage, guards (no Next.js, no React)
  worker/    the scheduler loop (scans and subreddit checks)
  cli/       pnpm scan and pnpm eval
  app/       the Next.js dashboard (server components, server actions)
  proxy.ts   the optional password gate
```

## Processes

The dashboard and the worker are separate processes that share one SQLite file in WAL mode.
`pnpm dev`, `pnpm start` and Docker apply migrations once and then start both.

- **The worker is the only process that reads Reddit** (the CLI does too, under the same
  lock). That keeps every Reddit request behind one rate limiter. When the dashboard needs a
  subreddit checked or a scan started, it leaves a request in the database and the worker
  picks it up within a few seconds.
- **Only one scan runs at a time.** A lock row with a heartbeat in the settings table is
  taken in an immediate SQLite transaction; a lock whose heartbeat stopped is taken over.
- **The dashboard calls the AI provider directly** for interactive work: building a profile
  during onboarding, suggesting subreddits and regenerating a draft.

## The core library

Every module in `src/core` receives its dependencies as arguments: the database handle, the
Reddit source, the AI generator, the clock and the random source. There are no hidden
globals; `src/core/runtime.ts` is the one place that wires real implementations together, and
demo mode and tests replace parts of it.

| Folder      | Job                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `reddit/`   | Atom parsing, the HTTP client with block detection and retries, the global rate limiter, polling plans, the `RedditSource` interface |
| `ai/`       | Provider adapters (AI SDK), the AI client with budgets and usage records, output schemas, prompt templates, the fake generator       |
| `profile/`  | Website crawling, profile extraction, subreddit suggestions and validation                                                           |
| `pipeline/` | Prefilter, dedup, triage, qualify, veto, score, draft, review and the scan orchestration                                             |
| `guard/`    | Health warnings and pacing warnings                                                                                                  |
| `notify/`   | The webhook                                                                                                                          |
| `serp/`     | Optional: the DataForSEO client and the weekly check for Reddit threads that rank on Google                                          |
| `db/`       | Schema, migrations and small query modules; nothing else touches the database                                                        |
| `secrets/`  | Encryption, the secret store and redaction                                                                                           |
| `settings/` | Typed settings with defaults and validation                                                                                          |
| `eval/`     | The golden set and the evaluation                                                                                                    |
| `demo/`     | Sample products, the demo seed and demo-mode replacements                                                                            |

## Boundaries

- Input is validated with Zod where it enters: environment variables, settings, server
  action arguments, feed entries, AI output and stored JSON.
- Only `reddit/client.ts`, `ai/provider.ts`, `profile/crawl.ts`, `notify/webhook.ts` and
  `serp/dataforseo.ts` call `fetch`; a lint rule enforces it. The crawler, the webhook and
  DataForSEO reach the network by design (your product site, your webhook and, when you set it
  up, Google results), in addition to Reddit and the AI provider.
- Expected failures are values (`{ ok: false, kind, message }`), not exceptions. A scan
  never throws: problems end up in the run's status and error.
- Logging goes through one logger that redacts stored secrets and anything shaped like a key.

## Data model

| Table                            | Holds                                                               |
| -------------------------------- | ------------------------------------------------------------------- |
| `products`, `product_subreddits` | Products, their profiles and the subreddits each watches            |
| `subreddits`                     | Shared poll state, blocks, promotion policy and rules               |
| `posts`                          | Each Reddit post once, with a content hash for cross-post detection |
| `evaluations`                    | One verdict per product, post and stage, with a reason              |
| `leads`, `drafts`                | Posts that became leads, and their draft versions                   |
| `feedback`                       | Good and bad marks with notes                                       |
| `runs`, `usage`                  | Scan history with funnel counts, and the AI cost ledger             |
| `serp_runs`, `serp_threads`      | Evergreen checks with their cost, and the threads that ranked       |
| `settings`, `secrets`            | Settings, internal state and encrypted keys                         |

Timestamps are UTC epoch seconds and ids are text.
