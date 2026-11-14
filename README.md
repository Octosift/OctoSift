# Octosift

Find the people on Reddit who need what you built, and reply to them yourself, helpfully
and honestly.

<!-- TODO(owner): add the demo GIF here once it is recorded (pnpm demo provides the data). -->

Octosift runs on your own machine. It reads a short list of subreddits you choose, picks
out posts from people your product can actually help, explains why, and prepares a reply in
your voice that you copy and post by hand.

## What it does

1. **Learns your product.** Give it your website. It reads a few pages, drafts a profile
   (what the product does, who it is for, what it does _not_ do) and asks you a few
   questions to sharpen it.
2. **Suggests subreddits.** You confirm three to ten communities where your customers ask
   questions.
3. **Reads new posts on a schedule.** Every hour by default, one feed request per group of
   subreddits.
4. **Filters, judges and scores every post.** Free checks first, then a cheap model, then a
   strong model, then deterministic rules. Each post gets a verdict and a reason you can
   inspect.
5. **Prepares replies for strong leads.** A draft in your voice that discloses that you
   built the product whenever it mentions it, reviewed by a second model. You copy it, open
   the thread and post it yourself.

```
feed entries
  -> filters (free: age, removed posts, bots, spam links, language, your blocklist)
  -> triage (cheap model, ten posts per call, title and start of the body)
  -> qualify (strong model, one post per call, full text)
  -> veto and score (rules that can only lower a result, freshness, risk flags)
  -> inbox (score 60 and up)
  -> draft and review (score 75 and up, or on request)
```

## What it does not do

- **It does not post, comment, vote or send messages.** There is no browser extension and no
  Reddit login. You post every reply yourself.
- **It does not monitor all of Reddit by keyword.** It reads the short list of subreddits
  you chose.
- **It does not hide who is speaking.** Drafts are written in your own voice and say that you
  built the product whenever they mention it.

That is the point: a tool that helps you show up where you are useful, without turning you
into a spammer.

## Quick start

You need pnpm and Node.js on a long-term support line: 22.12 or later, 24 (recommended, and
what `.nvmrc` selects) or 26. Node 20 and the odd-numbered releases are not supported; the
test runner refuses them. On Node 26 the SQLite driver is compiled during `pnpm install`,
which needs a C++ toolchain (Xcode command line tools on macOS, `python3`, `make` and `g++`
on Linux).

```sh
pnpm install
pnpm demo
```

`pnpm demo` builds a demo database with a sample product and a few days of history, then
starts the dashboard at http://127.0.0.1:3000 with a simulated AI provider and synthetic
Reddit posts. No key and no network are needed.

When you are ready for the real thing:

```sh
cp .env.example .env   # optional; every setting can also be made in the dashboard
pnpm build
pnpm start             # dashboard and worker
```

Open http://127.0.0.1:3000 and follow the four onboarding steps: AI provider, product,
subreddits, first scan. For development, `pnpm dev` runs both processes with reloading.

### With Docker

```sh
docker compose up --build
```

The dashboard is published on 127.0.0.1:3000 only. Data lives in a named volume. Put keys
and options in `.env` (see `.env.example`); set `APP_PASSWORD` before exposing the dashboard
beyond your machine.

### From the command line

```sh
pnpm scan --once              # one scan now, prints the new leads
pnpm scan --once --dry-run    # fetch and classify, save nothing but the run
pnpm scan --once --json       # the full report as JSON
```

## How it reads Reddit, and why it is slow on purpose

Octosift reads public Atom feeds (`/r/<subreddit>/new/.rss`) without logging in. One
request returns up to 100 new posts with their full text, so each scan needs only one
request per subreddit, and quiet subreddits share a single combined request.

Logged-out reads have a tight rate limit, roughly one request a minute. Octosift follows
Reddit's rate-limit headers, sends one request at a time, and when Reddit pushes back
(HTTP 429, 403 or a block page) it stops reading for at least ten minutes instead of
retrying. Reading slowly is what keeps your network from being blocked. A dashboard banner
tells you when reads will resume; a proxy setting and, later, your own Reddit app
credentials are available if blocks keep happening.

Subreddits that are busy enough to overflow a feed between scans are read on their own and
more often, down to every fifteen minutes.

## Cost

You bring your own AI provider (OpenAI, Anthropic, Google, or any OpenAI-compatible endpoint
such as OpenRouter, Ollama or LM Studio) and pick one model per stage. Spending stays low
because each stage only sees what the previous one let through:

- free filters remove removed posts, bots, spam, old posts and other languages;
- a cheap model screens the rest ten at a time, from the title and the first 600 characters;
- only the posts it keeps reach the strong model, one at a time;
- only strong leads get a draft and a review.

An illustrative scan of five subreddits that finds 40 new posts, with a small model at
$0.15/$0.60 and a strong model at $3/$15 per million input/output tokens:

| Stage            | Calls | Input tokens | Output tokens |            Cost |
| ---------------- | ----: | -----------: | ------------: | --------------: |
| Filters          |     0 |            0 |             0 |          $0.000 |
| Triage (small)   |     4 |       14,000 |         1,600 |          $0.003 |
| Qualify (strong) |     8 |       14,400 |         2,000 |          $0.073 |
| Draft (strong)   |     3 |        5,100 |           900 |          $0.029 |
| Review (small)   |     3 |        4,800 |           360 |          $0.001 |
| **Total**        |       |              |               | **about $0.11** |

Your numbers will differ: every run's actual cost is shown on the Runs screen, from a price
table you can edit in Settings. Budget caps stop a scan cleanly (default $0.50 per scan and
$3 per 24 hours) and leave the remaining posts for the next scan.

## Responsible use

- **Follow each subreddit's rules.** Paste a subreddit's rules on the Subreddits screen and
  they are summarised into what replies may do there. Mark subreddits that do not allow
  promotion; drafts for them never mention your product.
- **Say who you are.** Every draft that mentions the product says plainly that you built it.
  Keep it that way when you edit.
- **Help first.** A good reply is useful even if the sentence about your product is removed.
  The pacing warnings tell you when your recent replies lean too much towards promotion.
- **Never invent experience.** Drafts are told not to claim results, customers or comparisons
  that are not in your profile. Check before you post.

## Configuration

Settings live in the dashboard and are stored in a local SQLite file. Environment variables
(see `.env.example`) cover deployment options and can supply provider keys.

| Variable                                                                                           | Default                      | Purpose                                                              |
| -------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `DATABASE_PATH`                                                                                    | `data/app.sqlite`            | Where the database lives                                             |
| `APP_SECRET`                                                                                       | random key in `data/.secret` | Encrypts saved API keys                                              |
| `APP_PASSWORD`                                                                                     | none                         | Requires a password to open the dashboard                            |
| `HOST`, `PORT`                                                                                     | `127.0.0.1`, `3000`          | Where the dashboard listens                                          |
| `PUBLIC_URL`                                                                                       | `http://127.0.0.1:3000`      | Used for links in notifications                                      |
| `LOG_LEVEL`                                                                                        | `info`                       | `debug`, `info`, `warn` or `error`                                   |
| `DEMO_MODE`                                                                                        | off                          | Synthetic data and a simulated AI provider                           |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_COMPATIBLE_API_KEY` | none                         | Provider keys; they take precedence over keys saved in the dashboard |
| `REDDIT_PROXY_URL`                                                                                 | none                         | Proxy for Reddit reads                                               |
| `WEBHOOK_URL`                                                                                      | none                         | Webhook for strong leads (Slack-style or Discord-style)              |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`                                                          | none                         | Optional: finds Reddit threads that rank on Google for your keywords |

In the dashboard you also set the model for each stage, prices, budget caps, the scan
interval, score thresholds, filters, your Reddit username (to skip your own posts), the
User-Agent and whether images in posts are described for the models (off by default).

**Evergreen threads (optional).** With DataForSEO credentials (in Settings or the environment),
an Evergreen tab lists the Reddit threads that rank on Google for your buyer keywords, checked
once a week or on demand. Old threads that rank keep being read, so a helpful reply there pays
off for months. A check costs about $0.004 per keyword and the exact cost of each one is shown.

## FAQ

**Does it work for my kind of product?** Nothing in the code assumes an industry or an
audience. Everything specific comes from your product profile and settings. The test suite
runs the whole pipeline against three unrelated sample products: an invoicing tool for
freelancers, a consumer plant-care app and a developer command-line tool.

**Can I use a local model?** Yes. Choose "OpenAI-compatible" and point it at Ollama or
LM Studio. Smaller local models are fine for triage; qualify and drafting benefit from
stronger models.

**Where is my data?** In the SQLite file on your machine. Keys are encrypted. Nothing is
sent anywhere except Reddit (reads only), your AI provider and the optional webhook. See
[docs/privacy.md](docs/privacy.md).

**How do I know it is finding the right posts?** Every verdict has a reason, visible on the
Runs screen. Mark leads as good or bad with a note in the inbox and the notes become rules
the next scans follow. `pnpm eval --yes-spend` measures precision and recall of your chosen
models on a labelled set of sample posts. It costs a little, explains what it will send
before it starts, and stops at a cap (one dollar by default).

**Why is the first scan slow?** Reddit allows about one logged-out request a minute. The
AI stages are quick.

<!-- TODO(owner): decide whether to compare with other kinds of tools here (keyword alert bots, paid lead tools) and whether to mention a hosted version. -->

## Roadmap

- Checks that your posted replies are visible to logged-out readers.
- A browser extension for one-click copy on Reddit itself.
- More sources besides Reddit.
- An MCP server, so assistants can query your leads.

## Documentation

- [Architecture](docs/architecture.md)
- [The pipeline and its prompts](docs/pipeline.md)
- [Adding a new source](docs/adding-a-source.md)
- [Privacy: what is stored and where](docs/privacy.md)
- [How logged-out Reddit reads behave](docs/reddit-reads.md)
- [Decisions](docs/decisions.md)

## Development

```sh
pnpm check       # lint, typecheck, unit tests and the leak check
pnpm test:e2e    # Playwright smoke tests (demo mode, needs a Chromium download)
```

<!-- TODO(owner): choose a licence and add the licence section and file. -->
