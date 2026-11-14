# The pipeline

Each scan moves posts through the same stages. Every stage a post reaches writes a verdict
(`pass`, `skip` or `error`) with a reason, so the Runs screen can show why each post went where
it went. An `error` is never a judgement: the post is tried again on the next scan.

## 1. Fetch

Due subreddits are read from their public Atom feeds; quiet ones are combined, up to five per
request. Each subreddit is processed up to the first post already stored, and the first read of
a new subreddit only keeps the last 48 hours. Posts whose normalised title and opening match a
post in another subreddit are marked as cross-posts of the older one.

## 2. Filters (free)

Posts are skipped, with a named reason, when they are older than the maximum age, removed or
deleted, have neither text nor an image, are on a user profile, come from you or a bot, come
from a blocklisted subreddit or contain a blocklisted term, link to several unknown sites, or
are written in a language the product does not support (only judged for longer posts, since
detection on short text is unreliable).

Posts that mention the product by name or domain are kept as **brand mentions** and shown in
their own inbox tab, without a drafted pitch.

### Image posts (optional)

With **Describe images in posts** on (Settings, Models), the qualify model describes the image
of each post hosted on Reddit once, in up to 150 words. The description is added to the text
the later stages read, as `[IMAGE] …`, and cached by image address. A failure is skipped
silently and no more images are tried in that scan, so a model that does not accept images
costs one call. Evidence quotes are still checked against the author's own words.

## 3. Triage (cheap model)

Up to ten posts per call, each as its title and the first 600 characters. The model sees the
short profile (under 200 words, built from the profile's own fields) and the list of things
the product does not do. It is asked to be generous, because the next stage checks carefully,
and to reject announcements, memes, job ads, self-promotion and topics the product does not
cover.

If an answer leaves posts out or names posts that were not asked about, the missing posts are
asked about one at a time.

## 4. Qualify (strong model)

One post per call, with its full text, the full profile, the subreddit's rules summary when
known, and what the founder taught it: recent notes from good and bad marks, and the latest
good and bad leads as examples. The model returns:

- **fit**: direct (asks for, or clearly needs, what the product does), soft (related, a helpful
  reply could mention it), or none;
- **intent**, such as asking for a recommendation, describing a problem, or venting;
- **score** from 0 to 100 against a written scale, with the instruction to choose the lower
  score when unsure;
- a word-for-word **evidence quote**, whether mentioning the product is acceptable, whether the
  author invited private messages, a suggested angle, and risk flags.

The evidence quote is checked against the post. A paraphrased quote is flagged, because a quote
that is not in the post is not evidence.

## 5. Veto and score (code)

Rules the founder or the subreddit decided, which can only lower a result:

- no fit, a vendor, a job ad, self-promotion or a veto phrase means not a lead;
- venting or a request for no tools turns product mentions off;
- a subreddit marked as no promotion, or whose rules forbid it, turns mentions off as well.

The final score is the model's score multiplied by freshness (1.0 under 6 hours, 0.9 under a
day, 0.75 under two days, 0.5 after that), minus 10 for each of low effort, outside the target
market and sensitive topic, minus 20 for an unverified quote, and minus 5 for a thread with 100
or more comments, where a late reply gets buried. Leads start at 60.

Sources that report a post's score and comment count pass them to the qualify model too, and
posts they mark as locked, NSFW or removed are skipped by the free filters.

## 6. Draft and review

Leads scoring 75 and up get a draft automatically; others on request. The mode follows the
qualify result and the most promotional mode the founder allows:

- **helpful only**: answer the question, no product mention;
- **soft mention**: answer first, then one sentence about the product with disclosure;
- **direct**: the author asked for a recommendation, so lead with the product, with
  disclosure, and say where it does not fit.

The draft prompt asks for the founder's own voice, an answer that stays useful without the
product sentence, facts only from the profile, no invented experience, and one of several
structural hints so replies do not all share one shape. Code then checks for refusals, dashes,
links where links are not allowed, a missing disclosure and the length, and regenerates once
with the problems as fixes.

A second model reviews the draft as a moderator would. REVISE or REJECT leads to one more
attempt with the reviewer's fixes; a draft rejected twice is not stored, and the lead shows the
reasons instead. Private-message drafts are written only when the author invited messages and
the product allows them.

## Budgets and failures

Every AI call is recorded with its tokens and cost. Before each call the scan checks the
per-scan and 24-hour caps; when one is reached the scan stops cleanly and the remaining posts
wait for the next scan. A missing model or key, or more than 30% of calls failing, stops the
AI work for that scan and shows the provider's (redacted) message.

## Prompts

The templates live in `src/core/ai/prompts/` as plain functions of their inputs. Posts,
website text and subreddit rules are wrapped in named tags and the model is told to treat them
as material to evaluate, never as instructions; tags inside that text are neutralised so it
cannot break out. Structured output uses wire schemas with types and enums only, and the
length, count and range limits are applied in code after parsing.
