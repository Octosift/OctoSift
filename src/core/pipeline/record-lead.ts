/**
 * Turns a qualified post into a lead: stores it, reports it, notifies the
 * founder about strong ones and drafts replies for those above the draft
 * threshold. Brand mentions become leads of their own kind, without drafts.
 */
import type { QualifyResult, RulesSummary } from '../ai/schemas';
import type { PostRow } from '../db/queries/posts';
import { newId } from '../ids';
import {
  aiAvailable,
  type EvaluateContext,
  type LeadSummary,
  type ReadyProduct,
} from './evaluate-context';
import type { FunnelCounts } from './funnel';
import { draftForLead } from './lead-drafts';
import { containsTerm } from './prefilter';
import type { VetoOutcome } from './veto';

export interface Judgement {
  result: QualifyResult;
  veto: VetoOutcome;
  score: number;
  rules: RulesSummary | null;
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

export async function recordLead(
  ctx: EvaluateContext,
  product: ReadyProduct,
  post: PostRow,
  judgement: Judgement,
): Promise<void> {
  const { result, veto, score, rules } = judgement;
  const thresholds = ctx.settings.getForProduct(product.id, 'thresholds');
  const leadId = newId();
  const inserted = ctx.store.insertLead({
    id: leadId,
    productId: product.id,
    postId: post.id,
    kind: 'opportunity',
    score,
    modelScore: result.score,
    fit: result.fit,
    intent: result.intent,
    reason: result.reason,
    evidenceQuote: result.evidenceQuote,
    riskFlagsJson: veto.flags,
    mentionOk: veto.mentionOk,
    dmOk: veto.dmOk,
    suggestedAngle: result.suggestedAngle,
    status: 'new',
    runId: ctx.runId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });
  if (!inserted) return;
  ctx.counts.leads += 1;
  const summary: LeadSummary = {
    id: leadId,
    productName: product.name,
    score,
    title: post.title,
    subreddit: post.subreddit,
    url: post.url,
    reason: result.reason,
    drafted: false,
  };
  ctx.newLeads.push(summary);
  if (score >= thresholds.notify) await notifyLead(ctx, summary);
  if (score < thresholds.draft || !aiAvailable(ctx)) return;

  const drafted = await draftForLead(
    { ai: ctx.ai, store: ctx.store, random: ctx.random, log: ctx.log, now: ctx.now },
    {
      leadId,
      allowedMode: product.mode,
      profile: product.profile,
      post: { id: post.id, subreddit: post.subreddit, title: post.title, bodyText: post.bodyText },
      qualify: { ...result, mentionOk: veto.mentionOk, dmOk: veto.dmOk },
      rules,
      replyPreferences: ctx.settings.getForProduct(product.id, 'replyPreferences'),
    },
  );
  summary.drafted = drafted.reply === 'drafted';
  countDraft(ctx.counts, drafted.reply, 'reply');
  countDraft(ctx.counts, drafted.dm, 'dm');
}

function brandSentence(text: string, terms: string[]): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return (
    sentences.find((sentence) => terms.some((term) => containsTerm(sentence, term))) ??
    sentences[0] ??
    ''
  ).slice(0, 200);
}

export function recordBrandMention(
  ctx: EvaluateContext,
  product: ReadyProduct,
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
