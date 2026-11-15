'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isRedditShareLink, normalizeRedditUrl } from '@/core/urls';
import { scheduleReplyChecks } from '@/core/guard/visibility';
import { FITS, INTENTS } from '@/core/ai/schemas';
import { getLead, updateDraftText, updateLead } from '@/core/db/queries/leads';
import { getPost } from '@/core/db/queries/posts';
import { getProduct } from '@/core/db/queries/products';
import { getSubreddit, rulesSummaryOf } from '@/core/db/queries/subreddits';
import { insertFeedback } from '@/core/db/queries/feedback';
import { draftForLead } from '@/core/pipeline/lead-drafts';
import { createDbStore } from '@/core/pipeline/store';
import { startDraftProgress } from '../draft-progress';
import { getRuntime, nowSeconds } from '../runtime';

export type ActionResult = { ok: true } | { ok: false; error: string };

const leadId = z.string().min(1).max(100);
const MODES = ['helpful_only', 'soft_mention', 'direct'] as const;

function done(): ActionResult {
  revalidatePath('/inbox');
  return { ok: true };
}

function invalid(error: z.ZodError): ActionResult {
  return { ok: false, error: error.issues[0]?.message ?? 'Invalid input' };
}

const repliedInput = z.object({
  leadId,
  mentioned: z.boolean(),
  commentUrl: z
    .string()
    .trim()
    .max(500)
    .transform((value, ctx) => {
      if (value === '') return '';
      if (isRedditShareLink(value)) {
        ctx.addIssue({
          code: 'custom',
          message:
            'This is a short share link. Open it, then copy the address from the browser bar.',
        });
        return z.NEVER;
      }
      const normalized = normalizeRedditUrl(value);
      if (normalized === null) {
        ctx.addIssue({ code: 'custom', message: 'Paste the link to your comment on reddit.com' });
        return z.NEVER;
      }
      return normalized;
    })
    .optional(),
});

export async function markReplied(input: z.input<typeof repliedInput>): Promise<ActionResult> {
  const parsed = repliedInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const now = nowSeconds();
  const runtime = getRuntime();
  const commentUrl = parsed.data.commentUrl ?? '';
  // Visibility checks read with the connected account; without one the link is only kept.
  if (commentUrl !== '' && runtime.hasRedditAccount()) {
    scheduleReplyChecks(runtime.db, { leadId: parsed.data.leadId, commentUrl, now });
  }
  updateLead(
    runtime.db,
    parsed.data.leadId,
    {
      status: 'replied',
      repliedAt: now,
      repliedWithMention: parsed.data.mentioned,
      commentUrl: parsed.data.commentUrl === '' ? null : (parsed.data.commentUrl ?? null),
    },
    now,
  );
  return Promise.resolve(done());
}

const snoozeInput = z.object({ leadId, days: z.number().int().min(1).max(30) });

export async function snoozeLead(input: z.input<typeof snoozeInput>): Promise<ActionResult> {
  const parsed = snoozeInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const now = nowSeconds();
  updateLead(
    getRuntime().db,
    parsed.data.leadId,
    { status: 'snoozed', snoozedUntil: now + parsed.data.days * 86_400 },
    now,
  );
  return Promise.resolve(done());
}

const dismissInput = z.object({ leadId, reason: z.string().trim().max(200) });

export async function dismissLead(input: z.input<typeof dismissInput>): Promise<ActionResult> {
  const parsed = dismissInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const now = nowSeconds();
  updateLead(
    getRuntime().db,
    parsed.data.leadId,
    { status: 'dismissed', dismissReason: parsed.data.reason || null },
    now,
  );
  return Promise.resolve(done());
}

export async function restoreLead(input: { leadId: string }): Promise<ActionResult> {
  const parsed = z.object({ leadId }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { db } = getRuntime();
  const lead = getLead(db, parsed.data.leadId);
  if (!lead) return { ok: false, error: 'This lead no longer exists.' };
  updateLead(db, lead.id, { status: 'new', snoozedUntil: null, dismissReason: null }, nowSeconds());
  return Promise.resolve(done());
}

const draftTextInput = z.object({
  draftId: z.string().min(1).max(100),
  text: z.string().max(10_000),
});

export async function saveDraftText(input: z.input<typeof draftTextInput>): Promise<ActionResult> {
  const parsed = draftTextInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  updateDraftText(getRuntime().db, parsed.data.draftId, parsed.data.text);
  return Promise.resolve(done());
}

const regenerateInput = z.object({
  leadId,
  mode: z.enum(MODES).optional(),
  instruction: z.string().trim().max(300).optional(),
  /** Rewrite only this draft; without it, the reply and (when allowed) a private message. */
  only: z.enum(['reply', 'dm']).optional(),
});

/**
 * Writes a new draft on demand. Each step is published for the editor's
 * progress list, because a reviewed draft takes two to six model calls.
 */
export async function regenerateDraft(
  input: z.input<typeof regenerateInput>,
): Promise<ActionResult> {
  const parsed = regenerateInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const runtime = getRuntime();
  const { db } = runtime;
  const lead = getLead(db, parsed.data.leadId);
  const post = lead ? getPost(db, lead.postId) : null;
  const product = lead ? getProduct(db, lead.productId) : null;
  if (!lead || !post || !product?.profile)
    return { ok: false, error: 'This lead no longer exists.' };
  const only = parsed.data.only;
  if (only === 'dm' && !lead.dmOk) {
    return { ok: false, error: 'The author did not invite private messages.' };
  }
  const fit = z.enum(FITS).catch('soft').parse(lead.fit);
  const intent = z.enum(INTENTS).catch('other').parse(lead.intent);
  const progress = startDraftProgress(lead.id);
  const result = await draftForLead(
    {
      ai: runtime.ai(),
      store: createDbStore(db),
      random: runtime.random,
      log: runtime.log,
      now: nowSeconds(),
      onStep: progress.push,
    },
    {
      leadId: lead.id,
      allowedMode: product.mode,
      profile: product.profile,
      post: { id: post.id, subreddit: post.subreddit, title: post.title, bodyText: post.bodyText },
      qualify: {
        fit,
        intent,
        mentionOk: lead.mentionOk,
        dmOk: lead.dmOk,
        suggestedAngle: lead.suggestedAngle,
      },
      rules: rulesSummaryOf(getSubreddit(db, post.subreddit)),
      replyPreferences: runtime.settings.getForProduct(product.id, 'replyPreferences'),
      ...(parsed.data.mode ? { modeOverride: parsed.data.mode } : {}),
      ...(parsed.data.instruction ? { instruction: parsed.data.instruction } : {}),
      ...(only ? { kinds: [only] } : {}),
      updateStatus: lead.status === 'new',
    },
  ).finally(progress.finish);
  revalidatePath('/inbox');
  if (only === 'dm') {
    return result.dm === 'drafted'
      ? { ok: true }
      : { ok: false, error: 'Could not write a private message that passes review.' };
  }
  return result.reply === 'drafted'
    ? { ok: true }
    : { ok: false, error: result.message ?? 'No draft was written.' };
}

const feedbackInput = z.object({
  leadId,
  signal: z.enum(['good', 'bad']),
  note: z.string().trim().max(200),
});

export async function giveFeedback(input: z.input<typeof feedbackInput>): Promise<ActionResult> {
  const parsed = feedbackInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { db } = getRuntime();
  const lead = getLead(db, parsed.data.leadId);
  if (!lead) return { ok: false, error: 'This lead no longer exists.' };
  insertFeedback(db, {
    productId: lead.productId,
    leadId: lead.id,
    signal: parsed.data.signal,
    note: parsed.data.note,
    now: nowSeconds(),
  });
  revalidatePath('/product');
  return Promise.resolve(done());
}
