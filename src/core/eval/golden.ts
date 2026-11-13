/**
 * The labelled golden set: hand-written posts for each sample product with
 * the outcome a good pipeline should reach and the answers a good model
 * would give. Used by integration tests, demo mode and `pnpm eval`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { FITS, INTENTS, RISK_FLAGS } from '../ai/schemas';
import type { RedditPost } from '../reddit/types';

export const GOLDEN_OUTCOMES = [
  'lead',
  'below_threshold',
  'triage_skip',
  'veto',
  'crosspost',
  'prefilter_skip',
  'brand_mention',
  'too_old',
] as const;
export type GoldenOutcome = (typeof GOLDEN_OUTCOMES)[number];

export const goldenLabelSchema = z.object({
  category: z.string(),
  expect: z.enum(GOLDEN_OUTCOMES),
  relevant: z.boolean(),
  fit: z.enum(FITS),
  score: z.tuple([z.number(), z.number()]),
  intent: z.enum(INTENTS),
  evidence: z.string(),
  mentionOk: z.boolean(),
  dmOk: z.boolean(),
  riskFlags: z.array(z.enum(RISK_FLAGS)),
  draft: z.boolean(),
  review: z.enum(['APPROVE', 'REVISE', 'REJECT']).optional(),
});
export type GoldenLabel = z.output<typeof goldenLabelSchema>;

export const goldenPostSchema = z.object({
  id: z.string(),
  subreddit: z.string(),
  author: z.string(),
  ageHours: z.number(),
  title: z.string(),
  body: z.string(),
  links: z.array(z.string()),
  image: z.string().nullable(),
  label: goldenLabelSchema,
});
export type GoldenPost = z.output<typeof goldenPostSchema>;

export const goldenSetSchema = z.object({
  product: z.string(),
  subreddits: z.array(z.string()),
  posts: z.array(goldenPostSchema),
});
export type GoldenSet = z.output<typeof goldenSetSchema>;

export function loadGoldenSet(
  slug: string,
  root = resolve(process.cwd(), 'fixtures/golden'),
): GoldenSet {
  const raw: unknown = JSON.parse(readFileSync(resolve(root, `${slug}.json`), 'utf8'));
  return goldenSetSchema.parse(raw);
}

/** The golden post as a feed would deliver it, `ageHours` before `now`. */
export function goldenToRedditPost(post: GoldenPost, now: number): RedditPost {
  const createdAt = Math.round(now - post.ageHours * 3600);
  return {
    id: post.id,
    subreddit: post.subreddit,
    author: post.author,
    title: post.title,
    bodyText: post.body,
    bodyLinks: post.links,
    url: `https://www.reddit.com/r/${post.subreddit}/comments/${post.id.slice(3)}/demo_post/`,
    imageUrl: post.image,
    createdAt,
    archived: false,
  };
}

/** Score the fake model reports for a label: the middle of the expected band. */
export function labelScore(label: GoldenLabel): number {
  return Math.floor((label.score[0] + label.score[1]) / 2);
}
