/**
 * The evaluation half of a scan, for one product: prefilter, triage,
 * qualify, veto and score, then leads and drafts for the strong ones.
 *
 * Each post resumes where its evaluation stopped. Every stage writes a
 * verdict with a reason. AI failures leave posts retryable; a budget stop or
 * a tripped AI guard ends AI work for the rest of the scan.
 */
import type { AiClient } from '../ai/client';
import type { FeedbackContext } from '../ai/prompts/qualify';
import type { Random } from '../clock';
import { CONFIG } from '../config';
import type { Db } from '../db/client';
import type { PostRow } from '../db/queries/posts';
import type { Product } from '../db/queries/products';
import { watchedSubreddits } from '../db/queries/products';
import { getSubreddits, rulesSummaryOf } from '../db/queries/subreddits';
import type { EvaluationStage, EvaluationVerdict } from '../db/schema';
import { newId } from '../ids';
import type { Logger } from '../log';
import type { ProductProfile } from '../profile/types';
import type { RedditPost } from '../reddit/types';
import type { SettingsStore } from '../settings/store';
import type { AiGuard } from './ai-guard';
import { resumeStage } from './dedup';
import type { FunnelCounts } from './funnel';
import { draftForLead } from './lead-drafts';
import { containsTerm, prefilter, type PrefilterContext } from './prefilter';
import { qualifyPost } from './qualify';
import { finalScore } from './score';
import type { ScanStore } from './store';
import { triagePosts } from './triage';
import { applyVeto } from './veto';

export interface LeadSummary {
  id: string;
  productName: string;
  score: number;
  title: string;
  subreddit: string;
  url: string;
  reason: string;
  drafted: boolean;
}

export interface LeadNotice {
  leadId: string;
  productName: string;
  title: string;
  subreddit: string;
  score: number;
  reason: string;
  url: string;
}

export interface EvaluateContext {
  db: Db;
  store: ScanStore;
  ai: AiClient;
  guard: AiGuard;
  settings: SettingsStore;
  counts: FunnelCounts;
  log: Logger;
  random: Random;
  runId: string;
  now: number;
  detectLanguage: (text: string) => string | null;
  feedbackFor: (productId: string) => FeedbackContext;
  /** Resolves to true when the notification was delivered. */
  notify: ((notice: LeadNotice) => Promise<boolean>) | null;
  newLeads: LeadSummary[];
  /** Called after each step so progress can be shown while the scan runs. */
  onProgress: () => void;
  /** Set once the budget is exhausted; shared across products. */
  state: { budgetStop: string | null };
}

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

function brandSentence(text: string, terms: string[]): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return (
    sentences.find((sentence) => terms.some((term) => containsTerm(sentence, term))) ??
    sentences[0] ??
    ''
  ).slice(0, 200);
}

export async function evaluateProduct(
  ctx: EvaluateContext,
  product: Product & { profile: ProductProfile },
  candidateIds: string[],
): Promise<void> {
  const { profile } = product;
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
  const byId = new Map(posts.map((post) => [post.id, post]));
  const subredditRows = new Map(getSubreddits(ctx.db, [...watched]).map((row) => [row.name, row]));
  const thresholds = ctx.settings.getForProduct(product.id, 'thresholds');

  const save = (
    postId: string,
    stage: EvaluationStage,
    verdict: EvaluationVerdict,
    reason: string,
    extra: { data?: unknown; model?: string | null } = {},
  ) => {
    ctx.store.saveEvaluation({
      productId: product.id,
      postId,
      stage,
      verdict,
      reason,
      dataJson: extra.data ?? null,
      model: extra.model ?? null,
      runId: ctx.runId,
      createdAt: ctx.now,
    });
  };

  const brandTerms = [profile.name, hostOf(profile.url)].filter((term) => term.length > 0);
  const prefilterContext: PrefilterContext = {
    now: ctx.now,
    maxPostAgeHours: ctx.settings.get('prefilter.maxPostAgeHours'),
    ownUsername: ctx.settings.get('reddit.ownUsername') ?? profile.reddit_username,
    blocklist: ctx.settings.get('blocklist'),
    languages: ctx.settings.get('prefilter.languages'),
    brandTerms,
    detectLanguage: ctx.detectLanguage,
  };

  const toTriage: PostRow[] = [];
  const toQualify: PostRow[] = [];
  for (const post of posts) {
    const resume = resumeStage(records.get(post.id) ?? []);
    if (resume === 'triage') toTriage.push(post);
    if (resume === 'qualify') toQualify.push(post);
    if (resume !== 'prefilter') continue;

    const verdict = post.duplicateOf
      ? ({
          verdict: 'skip',
          reason: 'crosspost',
          detail: `Cross-post of ${post.duplicateOf}`,
        } as const)
      : prefilter(toRedditPost(post, ctx.now), prefilterContext);
    if (verdict.verdict === 'skip') {
      save(post.id, 'prefilter', 'skip', verdict.reason, { data: { detail: verdict.detail } });
      ctx.counts.prefilter.skip += 1;
      continue;
    }
    ctx.counts.prefilter.pass += 1;
    if (verdict.brandMention) {
      save(post.id, 'prefilter', 'pass', 'brand_mention');
      recordBrandMention(ctx, product, post, brandTerms);
      continue;
    }
    save(post.id, 'prefilter', 'pass', 'passed');
    toTriage.push(post);
  }

  ctx.onProgress();
  if (toTriage.length > 0 && aiAvailable(ctx)) {
    const run = await triagePosts(
      ctx.ai,
      profile,
      toTriage.map((post) => ({
        id: post.id,
        subreddit: post.subreddit,
        title: post.title,
        bodyText: post.bodyText,
      })),
    );
    for (const [postId, outcome] of run.outcomes) {
      save(postId, 'triage', outcome.verdict, outcome.reason, { model: outcome.model });
      ctx.counts.triage[outcome.verdict] += 1;
      const post = byId.get(postId);
      if (outcome.verdict === 'pass' && post) toQualify.push(post);
      if (outcome.verdict === 'error' && outcome.budget) ctx.state.budgetStop ??= outcome.reason;
    }
  }

  ctx.onProgress();
  const feedback = ctx.feedbackFor(product.id);
  for (const post of toQualify) {
    if (!aiAvailable(ctx)) break;
    const subreddit = subredditRows.get(post.subreddit) ?? null;
    const rules = rulesSummaryOf(subreddit);
    const outcome = await qualifyPost(
      ctx.ai,
      {
        id: post.id,
        subreddit: post.subreddit,
        title: post.title,
        bodyText: post.bodyText,
        createdAt: post.createdAt,
      },
      {
        profile,
        rulesSummary: rules ? `Promotion: ${rules.promotion}. Links: ${rules.links}.` : null,
        feedback,
        now: ctx.now,
      },
    );
    if (!outcome.ok) {
      save(post.id, 'qualify', 'error', outcome.message, { model: outcome.model });
      ctx.counts.qualify.error += 1;
      if (outcome.kind === 'budget') ctx.state.budgetStop ??= outcome.message;
      continue;
    }
    ctx.counts.qualify.pass += 1;
    save(post.id, 'qualify', 'pass', outcome.result.reason, {
      model: outcome.model,
      data: { ...outcome.result, internalFlags: outcome.internalFlags },
    });

    const veto = applyVeto({
      qualify: outcome.result,
      internalFlags: outcome.internalFlags,
      postText: `${post.title}\n${post.bodyText}`,
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
    if (!veto.lead || score < thresholds.show) {
      const reason = veto.lead
        ? `Score ${score} is below ${thresholds.show}`
        : veto.reasons.join('; ');
      save(post.id, 'veto', 'skip', reason, { data: { score, flags: veto.flags } });
      ctx.counts.veto.skip += 1;
      continue;
    }
    save(post.id, 'veto', 'pass', `Score ${score}`, { data: { score, flags: veto.flags } });
    ctx.counts.veto.pass += 1;

    const leadId = newId();
    const inserted = ctx.store.insertLead({
      id: leadId,
      productId: product.id,
      postId: post.id,
      kind: 'opportunity',
      score,
      modelScore: outcome.result.score,
      fit: outcome.result.fit,
      intent: outcome.result.intent,
      reason: outcome.result.reason,
      evidenceQuote: outcome.result.evidenceQuote,
      riskFlagsJson: veto.flags,
      mentionOk: veto.mentionOk,
      dmOk: veto.dmOk,
      suggestedAngle: outcome.result.suggestedAngle,
      status: 'new',
      runId: ctx.runId,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    if (!inserted) continue;
    ctx.counts.leads += 1;
    const summary: LeadSummary = {
      id: leadId,
      productName: product.name,
      score,
      title: post.title,
      subreddit: post.subreddit,
      url: post.url,
      reason: outcome.result.reason,
      drafted: false,
    };
    ctx.newLeads.push(summary);
    if (ctx.notify && score >= thresholds.notify) await notifyLead(ctx, summary);

    if (score >= thresholds.draft && aiAvailable(ctx)) {
      const drafted = await draftForLead(
        { ai: ctx.ai, store: ctx.store, random: ctx.random, log: ctx.log, now: ctx.now },
        {
          leadId,
          allowedMode: product.mode,
          profile,
          post: {
            id: post.id,
            subreddit: post.subreddit,
            title: post.title,
            bodyText: post.bodyText,
          },
          qualify: { ...outcome.result, mentionOk: veto.mentionOk, dmOk: veto.dmOk },
          rules,
          replyPreferences: ctx.settings.getForProduct(product.id, 'replyPreferences'),
        },
      );
      summary.drafted = drafted.reply === 'drafted';
      countDraft(ctx.counts, drafted.reply, 'reply');
      countDraft(ctx.counts, drafted.dm, 'dm');
    }
  }
}

function aiAvailable(ctx: EvaluateContext): boolean {
  return ctx.state.budgetStop === null && ctx.guard.tripped() === null;
}

function countDraft(counts: FunnelCounts, status: string, kind: 'reply' | 'dm'): void {
  if (status === 'drafted') counts.drafts[kind] += 1;
  else if (status === 'rejected') counts.drafts.rejected += 1;
  else if (status === 'failed') counts.drafts.failed += 1;
}

async function notifyLead(ctx: EvaluateContext, lead: LeadSummary): Promise<void> {
  if (!ctx.notify) return;
  try {
    const delivered = await ctx.notify({
      leadId: lead.id,
      productName: lead.productName,
      title: lead.title,
      subreddit: lead.subreddit,
      score: lead.score,
      reason: lead.reason,
      url: lead.url,
    });
    if (delivered) ctx.store.updateLead(lead.id, { notifiedAt: ctx.now }, ctx.now);
  } catch (error) {
    ctx.log.warn('Lead notification failed', { leadId: lead.id, error });
  }
}

function recordBrandMention(
  ctx: EvaluateContext,
  product: Product & { profile: ProductProfile },
  post: PostRow,
  terms: string[],
): void {
  const inserted = ctx.store.insertLead({
    id: newId(),
    productId: product.id,
    postId: post.id,
    kind: 'brand_mention',
    score: 0,
    modelScore: 0,
    fit: 'brand',
    intent: 'other',
    reason: `Mentions ${product.profile.name}`,
    evidenceQuote: brandSentence(`${post.title}. ${post.bodyText}`, terms),
    riskFlagsJson: [],
    mentionOk: false,
    dmOk: false,
    suggestedAngle: '',
    status: 'new',
    runId: ctx.runId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });
  if (inserted) ctx.counts.brandMentions += 1;
}
