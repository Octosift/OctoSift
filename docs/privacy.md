# Privacy: what is stored and where

Everything stays on the machine that runs Octosift.

## Where

- **The database**: one SQLite file, `data/app.sqlite` by default (`DATABASE_PATH`). With
  Docker it lives in the `app-data` volume.
- **The encryption key**: `data/.secret`, created on first run with permissions `0600`, unless
  you set `APP_SECRET`.
- **Demo mode** uses `data/demo.sqlite` and never touches your real database.

## What

- **Your products**: the profile built from your website and your answers to the interview.
- **Reddit posts** from the subreddits you chose: title, body text, links, author name,
  subreddit, permalink and times. Each post is stored once.
- **Verdicts** for every post that reached a stage, with the model's reasons, and the leads,
  drafts and private-message drafts written for you.
- **Your actions**: replied, snoozed and dismissed leads, the links to comments you posted if
  you added them, and your good or bad marks with notes.
- **Scan history and AI usage**: counts per stage, token counts and costs.
- **Image descriptions**, if you turn them on: the description of each post image, by its
  address.
- **Evergreen threads**, if you set up DataForSEO: the keywords you check, the Reddit threads
  that ranked for them (address, title, rank and date) and the cost of each check.
- **Settings and keys**: settings in plain JSON; API keys, a connected Reddit account's session
  cookie, the DataForSEO login and password, the webhook URL and the proxy URL encrypted with
  AES-256-GCM.
- **Reply and account checks**, if a Reddit account is connected: whether each reply you linked
  could still be seen an hour and a day after you posted it, and the result of the last daily
  check of the connected account's public profile.

Saved keys are never sent back to the browser: the dashboard only ever receives a mask such as
`sk-…a1b2`. Logs and error messages pass through a redactor that removes stored secrets and
anything shaped like a key.

## What leaves your machine

- **Reddit**: read-only requests, with your connected account's session cookie when you connect
  one (the cookie is sent only to www.reddit.com), or logged out. With an account these are
  subreddit listings, the account's name (`/api/me.json`), the threads of comment links you add
  for reply checks, and the account's own public profile once a day; logged out, the public
  feeds of the subreddits you watch.
- **Your AI provider**: post text, your product profile and drafts, to the provider and models
  you configure, and the addresses of post images if you turn on image descriptions.
- **The Codex CLI**, only if you turn on the experimental provider: the same prompts an AI
  provider would get, run by the CLI on this computer under your own ChatGPT sign-in. No API keys
  are passed to it.
- **Your product's website**: read once when you build a profile.
- **DataForSEO**, if you set it up: your keywords, once a week or when you press Check now.
- **Your webhook**, if you set one: the title, subreddit, score and reason of strong leads, with
  a link to the lead in your dashboard.

There is no telemetry and no analytics. The npm scripts and the Docker image turn off Next.js
telemetry.

## Removing data

Settings has **Export JSON** (everything except keys) and **Delete all data** (everything,
including saved keys). Deleting a product removes its leads, drafts and feedback; posts and
subreddits shared with other products are kept.
