/**
 * The evaluation half of a scan, for one product: prefilter, image
 * descriptions when enabled, triage, then qualify, veto and score for each
 * remaining post.
 *
 * Each post resumes where its evaluation stopped. Every stage writes a
 * verdict with a reason. AI failures leave posts retryable; a budget stop or
 * a tripped AI guard ends AI work for the rest of the scan.
 */
import { CONFIG } from '../config';
import type { PostRow } from '../db/queries/posts';
import { watchedSubreddits } from '../db/queries/products';
import { getSubreddits, rulesSummaryOf, type SubredditRow } from '../db/queries/subreddits';
import type { RedditPost } from '../reddit/types';
import { resumeStage } from './dedup';
import { describeImages, withImage, withoutImage } from './images';
import {
  aiAvailable,
  saveVerdict,
  type EvaluateContext,
  type ReadyProduct,
} from './evaluate-context';
import { prefilter, type PrefilterContext } from './prefilter';
import { qualifyPost } from './qualify';
import { recordBrandMention, recordLead } from './record-lead';
import { finalScore } from './score';
import { triagePosts } from './triage';
import { applyVeto } from './veto';

export type { EvaluateContext, LeadNotice, LeadSummary } from './evaluate-context';

function toRedditPost(row: PostRow, now: number): RedditPost {
  return {
    id: row.id,
    subreddit: row.subreddit,
    author: row.author,
    title: row.title,
    bodyText: row.bodyText,
    bodyLinks: row.bodyLinksJson,
    url: row.url,
    imageUrl: row.imageUrl,
    createdAt: row.createdAt,
    archived: now - row.createdAt > CONFIG.reddit.archiveAfterS,
    score: row.score,
    commentCount: row.commentCount,
    nsfw: row.nsfw,
    locked: row.locked,
    removed: row.removed,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // A profile URL that cannot be parsed contributes no domain term.
    return '';
  }
}

/** Runs the free checks on posts seen for the first time; returns those that passed. */
function prefilterStep(ctx: EvaluateContext, product: ReadyProduct, posts: PostRow[]): PostRow[] {
  const { profile } = product;
  const brandTerms = [profile.name, hostOf(profile.url)].filter((term) => term.length > 0);
  const context: PrefilterContext = {
    now: ctx.now,
    maxPostAgeHours: ctx.settings.get('prefilter.maxPostAgeHours'),
    ownUsername: ctx.settings.get('reddit.ownUsername') ?? profile.reddit_username,
    blocklist: ctx.settings.get('blocklist'),
    languages: ctx.settings.get('prefilter.languages'),
    brandTerms,
    detectLanguage: ctx.detectLanguage,
  };
  const passed: PostRow[] = [];
  for (const post of posts) {
    const verdict = post.duplicateOf
      ? ({
          verdict: 'skip',
          reason: 'crosspost',
          detail: `Cross-post of ${post.duplicateOf}`,
        } as const)
      : prefilter(toRedditPost(post, ctx.now), context);
    if (verdict.verdict === 'skip') {
      saveVerdict(ctx, product.id, post.id, 'prefilter', 'skip', verdict.reason, {
        data: { detail: verdict.detail },
      });
      ctx.counts.prefilter.skip += 1;
      continue;
    }
    ctx.counts.prefilter.pass += 1;
    if (verdict.brandMention) {
      saveVerdict(ctx, product.id, post.id, 'prefilter', 'pass', 'brand_mention');
      recordBrandMention(ctx, product, post, brandTerms);
      continue;
    }
    saveVerdict(ctx, product.id, post.id, 'prefilter', 'pass', 'passed');
    passed.push(post);
  }
  return passed;
}

/** Screens posts with the triage model; returns those it kept. */
async function triageStep(
  ctx: EvaluateContext,
  product: ReadyProduct,
  posts: PostRow[],
): Promise<PostRow[]> {
  if (posts.length === 0 || !aiAvailable(ctx)) return [];
  const byId = new Map(posts.map((post) => [post.id, post]));
  const run = await triagePosts(
    ctx.ai,
    product.profile,
    posts.map((post) => ({
      id: post.id,
      subreddit: post.subreddit,
      title: post.title,
      bodyText: post.bodyText,
    })),
  );
  const kept: PostRow[] = [];
  for (const [postId, outcome] of run.outcomes) {
    saveVerdict(ctx, product.id, postId, 'triage', outcome.verdict, outcome.reason, {
      model: outcome.model,
    });
    ctx.counts.triage[outcome.verdict] += 1;
    const post = byId.get(postId);
    if (outcome.verdict === 'pass' && post) kept.push(post);
    if (outcome.verdict === 'error' && outcome.budget) ctx.state.budgetStop ??= outcome.reason;
  }
  return kept;
}

/** Qualifies one post, applies the veto rules and the score, and records a lead when it passes. */
async function judgePost(
  ctx: EvaluateContext,
  product: ReadyProduct,
  post: PostRow,
  subreddit: SubredditRow | null,
): Promise<void> {
  const rules = rulesSummaryOf(subreddit);
  const outcome = await qualifyPost(
    ctx.ai,
    {
      id: post.id,
      subreddit: post.subreddit,
      title: post.title,
      bodyText: post.bodyText,
      createdAt: post.createdAt,
      score: post.score,
      commentCount: post.commentCount,
    },
    {
      profile: product.profile,
      rulesSummary: rules ? `Promotion: ${rules.promotion}. Links: ${rules.links}.` : null,
      feedback: ctx.feedbackFor(product.id),
      now: ctx.now,
    },
  );
  if (!outcome.ok) {
    saveVerdict(ctx, product.id, post.id, 'qualify', 'error', outcome.message, {
      model: outcome.model,
    });
    ctx.counts.qualify.error += 1;
    if (outcome.kind === 'budget') ctx.state.budgetStop ??= outcome.message;
    return;
  }
  ctx.counts.qualify.pass += 1;
  saveVerdict(ctx, product.id, post.id, 'qualify', 'pass', outcome.result.reason, {
    model: outcome.model,
    data: { ...outcome.result, internalFlags: outcome.internalFlags },
  });

  const busy = post.commentCount !== null && post.commentCount >= CONFIG.score.busyThreadComments;
  const veto = applyVeto({
    qualify: outcome.result,
    internalFlags: busy ? [...outcome.internalFlags, 'busy_thread'] : outcome.internalFlags,
    // Quotes must come from the author's words, not from an image description.
    postText: `${post.title}\n${withoutImage(post.bodyText)}`,
    subredditNoPromotion: subreddit?.promotionPolicy === 'no_promotion',
    rulesPromotion: rules?.promotion ?? null,
    vetoPhrases: ctx.settings.getForProduct(product.id, 'vetoPhrases'),
  });
  const score = finalScore({
    modelScore: outcome.result.score,
    ageHours: (ctx.now - post.createdAt) / 3600,
    flags: veto.flags,
  });
  ctx.onProgress();
  const { show } = ctx.settings.getForProduct(product.id, 'thresholds');
  const data = { score, flags: veto.flags };
  if (!veto.lead || score < show) {
    const reason = veto.lead ? `Score ${score} is below ${show}` : veto.reasons.join('; ');
    saveVerdict(ctx, product.id, post.id, 'veto', 'skip', reason, { data });
    ctx.counts.veto.skip += 1;
    return;
  }
  saveVerdict(ctx, product.id, post.id, 'veto', 'pass', `Score ${score}`, { data });
  ctx.counts.veto.pass += 1;
  await recordLead(ctx, product, post, { result: outcome.result, veto, score, rules });
}

export async function evaluateProduct(
  ctx: EvaluateContext,
  product: ReadyProduct,
  candidateIds: string[],
): Promise<void> {
  const watched = new Set(
    watchedSubreddits(ctx.db, product.id)
      .filter((entry) => entry.enabled)
      .map((entry) => entry.subreddit),
  );
  const posts = ctx.store.getPosts(candidateIds).filter((post) => watched.has(post.subreddit));
  const records = ctx.store.stageRecords(
    product.id,
    posts.map((post) => post.id),
  );
  const at = (point: ReturnType<typeof resumeStage>) =>
    posts.filter((post) => resumeStage(records.get(post.id) ?? []) === point);

  const fresh = prefilterStep(ctx, product, at('prefilter'));
  ctx.onProgress();
  const waiting = [...at('triage'), ...fresh];
  const resuming = at('qualify');
  const images = aiAvailable(ctx)
    ? await describeImages(ctx, [...waiting, ...resuming])
    : new Map<string, string>();
  const read = (post: PostRow): PostRow =>
    images.has(post.id)
      ? { ...post, bodyText: withImage(post.bodyText, images.get(post.id)) }
      : post;
  const kept = await triageStep(ctx, product, waiting.map(read));
  ctx.onProgress();

  const subreddits = new Map(getSubreddits(ctx.db, [...watched]).map((row) => [row.name, row]));
  for (const post of [...resuming.map(read), ...kept]) {
    if (!aiAvailable(ctx)) break;
    await judgePost(ctx, product, post, subreddits.get(post.subreddit) ?? null);
  }
}
