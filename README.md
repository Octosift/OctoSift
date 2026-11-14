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
3. **Reads new posts on a schedule.** Every hour by default, through a Reddit account you
   connect or public feeds, slowly and one request at a time.
4. **Filters, judges and scores every post.** Free checks first, then a cheap model, then a
   strong model, then deterministic rules. Each post gets a verdict and a reason you can
   inspect.
5. **Prepares replies for strong leads.** A draft in your voice that discloses that you
   built the product whenever it mentions it, reviewed by a second model. You copy it, open
   the thread and post it yourself.

```
new posts
  -> filters (free: age, removed posts, bots, spam links, language, your blocklist)
  -> triage (cheap model, ten posts per call, title and start of the body)
  -> qualify (strong model, one post per call, full text)
  -> veto and score (rules that can only lower a result, freshness, risk flags)
  -> inbox (score 60 and up)
  -> draft and review (score 75 and up, or on request)
```

## What it does not do

- **It does not post, comment, vote or send messages.** A connected Reddit account is only used
  to read subreddit listings. You post every reply yourself.
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
starts the dashboard at http://127.0.0.1:3005 with a simulated AI provider and synthetic
Reddit posts. No key and no network are needed.

When you are ready for the real thing:

```sh
cp .env.example .env   # optional; every setting can also be made in the dashboard
pnpm build
pnpm start             # dashboard and worker
```

Open http://127.0.0.1:3005 and follow the five onboarding steps: AI provider, Reddit account
(you can skip it), product, subreddits, first scan. For development, `pnpm dev` runs both processes with reloading.

### With Docker

```sh
docker compose up --build
```

The dashboard is published on 127.0.0.1:3005 only. Data lives in a named volume. Put keys
and options in `.env` (see `.env.example`); set `APP_PASSWORD` before exposing the dashboard
beyond your machine.

### From the command line

```sh
pnpm scan --once              # one scan now, prints the new leads
pnpm scan --once --dry-run    # fetch and classify, save nothing but the run
pnpm scan --once --json       # the full report as JSON
```

## How it reads Reddit

In late 2026 Reddit ended support for its public RSS feeds and began closing its public data
API to new apps. Octosift therefore reads Reddit in one of two ways and falls back between
them:

1. **A Reddit account you connect** (the default). Subreddit listings are read with that
   account's session: one request at a time, at least eight seconds apart and at most 120 an
   hour. Use a separate account, not your main one; the app only reads, but automated reading
   can still get an account limited. Connect it during onboarding or in Settings, by signing
   in through a browser window the app opens (the app never sees your password), or by pasting
   the session cookie when the app runs in Docker. The cookie is stored encrypted and only ever
   sent to www.reddit.com.
2. **Public RSS feeds** (logged out, best effort). Reddit is retiring them, so they may return
   nothing or stop working at any time. Without a connected account they are the only way the
   app can read.

Demo mode reads synthetic posts instead and needs neither.

The source you prefer is tried first. If it stops working during a scan, for example when a
session expires, the rest of the scan uses the other one, and a banner says what happened.
`pnpm cli check-source` makes one request with the configured source, so you can test a
session before relying on it.

A connected account also serves two checks, at the same slow pace. An hour and a day after
you mark a lead as replied with your comment's link, the app reads that comment's own page
and tells you whether others can still see it. Once a day it reads the connected account's
public profile and warns if Reddit shows it as suspended or not found (usually a shadowban).
Reply from a different account than the connected one: Reddit shows authors their own removed
comments, so a check on them cannot tell.

Whatever the source, reading is slow on purpose: one request at a time, rate limits followed,
and a pause instead of retries when Reddit pushes back. Busy subreddits are read more often,
down to every fifteen minutes.

## Cost

You bring your own AI provider (OpenAI or Anthropic, or any OpenAI-compatible endpoint
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

### A worked example: ten subreddits every hour

Reading Reddit costs nothing: a connected account and the public feeds are both free. What you
pay for is AI, to your own provider, and it follows the number of new posts, because each post
is judged once.

Take ten subreddits that together get about 40 new posts an hour, scanned every hour with the
models in the table above. Each scan costs about $0.11, so a day costs about 24 × $0.11, roughly
$2.60, and a month about $80. The default caps hold it near there.

To spend less:

- **Keep a small model for triage.** Triage reads every post that passes the free filters. With
  the strong model in its place, triage would cost about $0.066 a scan instead of $0.003, and
  the example about $125 a month.
- **Watch fewer subreddits, or quieter ones.** Cost scales with new posts: five subreddits with
  20 new posts an hour together cost about $40 a month.
- **Scan fewer times a day.** This saves Reddit requests and keeps the account's reading
  lighter, but it barely changes the AI cost: a post costs the same in whichever scan reads it.
  It only saves AI when busy subreddits post more between scans than one scan reads, and then
  the posts it skips are ones you never see.
- **Choose a cheaper model for qualifying and drafting.** The strong model makes up most of the
  cost. Run `pnpm eval --yes-spend` before and after switching, to see what it does to
  precision.

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

| Variable                                                           | Default                      | Purpose                                                              |
| ------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------- |
| `DATABASE_PATH`                                                    | `data/app.sqlite`            | Where the database lives                                             |
| `APP_SECRET`                                                       | random key in `data/.secret` | Encrypts saved API keys                                              |
| `APP_PASSWORD`                                                     | none                         | Requires a password to open the dashboard                            |
| `HOST`, `PORT`                                                     | `127.0.0.1`, `3005`          | Where the dashboard listens                                          |
| `PUBLIC_URL`                                                       | `http://127.0.0.1:3005`      | Used for links in notifications                                      |
| `LOG_LEVEL`                                                        | `info`                       | `debug`, `info`, `warn` or `error`                                   |
| `DEMO_MODE`                                                        | off                          | Synthetic data and a simulated AI provider                           |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_COMPATIBLE_API_KEY` | none                         | Provider keys; they take precedence over keys saved in the dashboard |
| `REDDIT_PROXY_URL`                                                 | none                         | Proxy for Reddit reads                                               |
| `WEBHOOK_URL`                                                      | none                         | Webhook for strong leads (Slack-style or Discord-style)              |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`                          | none                         | Optional: finds Reddit threads that rank on Google for your keywords |
| `REDDIT_SESSION_COOKIE`                                            | none                         | The Cookie header of a connected Reddit account, instead of Settings |

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

**Why is the first scan slow?** Reads are spaced out on purpose, several seconds apart with an
account and about a minute apart logged out. The AI stages are quick.

<!-- TODO(owner): decide whether to compare with other kinds of tools here (keyword alert bots, paid lead tools) and whether to mention a hosted version. -->

## Roadmap

- A browser extension for one-click copy on Reddit itself.
- More sources besides Reddit.
- An MCP server, so assistants can query your leads.

## Documentation

- [Architecture](docs/architecture.md)
- [The pipeline and its prompts](docs/pipeline.md)
- [Adding a new source](docs/adding-a-source.md)
- [Privacy: what is stored and where](docs/privacy.md)
- [Data sources and the checks made with a connected account](docs/sources.md)
- [How logged-out Reddit reads behave](docs/reddit-reads.md)
- [Decisions](docs/decisions.md)

## Development

```sh
pnpm check       # lint, typecheck, unit tests and the leak check
pnpm test:e2e    # Playwright smoke tests (demo mode, needs a Chromium download)
```

<!-- TODO(owner): choose a licence and add the licence section and file. -->
