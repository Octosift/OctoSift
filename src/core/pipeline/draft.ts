/**
 * Stage 3: write a reply (or private message) in the founder's voice.
 *
 * The reply mode follows from the qualify result and the most promotional
 * mode the founder allows. Every draft passes deterministic checks (no
 * refusal, no dashes, no link where links are not allowed, disclosure
 * whenever the product is mentioned, sensible length). A failing draft is
 * regenerated once with the failures as fixes; if it still fails it is kept
 * but marked as needing an edit.
 */
import type { AiClient } from '../ai/client';
import { buildDraftPrompt } from '../ai/prompts/draft';
import { draftWire, normalizeDraft, type DraftOutput, type Fit, type Intent } from '../ai/schemas';
import type { AiFailureKind } from '../ai/types';
import type { Random } from '../clock';
import { CONFIG } from '../config';
import type { DraftKind, ReplyLength, ReplyMode } from '../db/schema';
import type { ProductProfile } from '../profile/types';
import { containsTerm } from './prefilter';

export function chooseMode(input: {
  allowed: ReplyMode;
  fit: Fit;
  intent: Intent;
  mentionOk: boolean;
}): ReplyMode {
  if (!input.mentionOk || input.allowed === 'helpful_only') return 'helpful_only';
  const asked = input.fit === 'direct' && input.intent === 'asking_for_recommendation';
  if (asked && input.allowed === 'direct') return 'direct';
  return 'soft_mention';
}

/** One of the structural hints, so a founder's replies do not all share one shape. */
export function pickVariationHint(random: Random): string {
  const hints = CONFIG.draft.variationHints;
  return hints[Math.floor(random() * hints.length)] ?? hints[0] ?? '';
}

export function wordBounds(
  kind: DraftKind,
  length: ReplyLength = 'medium',
): { min: number; max: number } {
  return kind === 'reply' ? CONFIG.draft.replyLengths[length].words : CONFIG.draft.dmWords;
}

/** How the prompt describes the length, beside the word range. */
export function lengthShape(kind: DraftKind, length: ReplyLength = 'medium'): string {
  return kind === 'reply' ? CONFIG.draft.replyLengths[length].shape : 'A few sentences.';
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export interface DraftCheckContext {
  mode: ReplyMode;
  linksAllowed: boolean;
  productName: string;
  productHost: string;
  words: { min: number; max: number };
}

/** Returns the problems with a draft, as fixes the model can act on; empty when it passes. */
export function checkDraft(output: DraftOutput, context: DraftCheckContext): string[] {
  const text = output.reply;
  const lower = text.toLowerCase();
  const failures: string[] = [];
  if (CONFIG.draft.refusalPhrases.some((phrase) => lower.includes(phrase))) {
    failures.push('Write the reply itself; do not refuse or talk about being an assistant.');
  }
  if (/[–—]/.test(text)) failures.push('Replace every em dash and en dash.');
  const hasLink =
    /https?:\/\/|www\./i.test(text) ||
    (context.productHost !== '' && lower.includes(context.productHost));
  if (hasLink && !context.linksAllowed)
    failures.push('Remove the link; links are not allowed here.');
  const mentions = output.mentionsProduct || containsTerm(text, context.productName);
  if (mentions && context.mode === 'helpful_only') {
    failures.push(`Do not mention ${context.productName} at all.`);
  } else if (mentions && !CONFIG.draft.disclosurePhrases.some((phrase) => lower.includes(phrase))) {
    failures.push(
      `Say plainly that you built ${context.productName}, for example "I'm the maker of".`,
    );
  }
  const words = countWords(text);
  if (words < context.words.min || words > context.words.max) {
    failures.push(
      `Use ${context.words.min} to ${context.words.max} words (this draft has ${words}).`,
    );
  }
  return failures;
}

export interface DraftRequest {
  kind: DraftKind;
  profile: ProductProfile;
  subreddit: string;
  mode: ReplyMode;
  linksAllowed: boolean;
  post: { id: string; title: string; body: string };
  suggestedAngle: string;
  /** Fixes requested by a reviewer, applied to the first attempt. */
  fixes: string[];
  random: Random;
  /** Replies only; medium when not set. */
  length?: ReplyLength;
}

export type DraftAttempt =
  | { ok: true; output: DraftOutput; failures: string[]; model: string }
  | { ok: false; kind: AiFailureKind; message: string };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    // A profile without a valid URL simply has no host to look for.
    return '';
  }
}

/**
 * What a draft request is doing, so the dashboard can show each step while
 * the user waits. `fix` and `revise` carry the first problem being fixed.
 */
export type DraftStep =
  | { step: 'write' }
  | { step: 'fix'; detail: string }
  | { step: 'review' }
  | { step: 'revise'; detail: string }
  | { step: 'recheck' };

export async function writeDraft(
  ai: AiClient,
  request: DraftRequest,
  onStep?: (step: DraftStep) => void,
): Promise<DraftAttempt> {
  const words = wordBounds(request.kind, request.length);
  const shape = lengthShape(request.kind, request.length);
  const variationHint = pickVariationHint(request.random);
  const checkContext: DraftCheckContext = {
    mode: request.mode,
    linksAllowed: request.linksAllowed,
    productName: request.profile.name,
    productHost: hostOf(request.profile.url),
    words,
  };

  let fixes = request.fixes;
  let last: DraftAttempt | null = null;
  for (let attempt = 0; attempt <= CONFIG.draft.maxRegenerations; attempt += 1) {
    if (attempt > 0) onStep?.({ step: 'fix', detail: fixes[0] ?? '' });
    const { system, prompt } = buildDraftPrompt({
      kind: request.kind,
      profile: request.profile,
      subreddit: request.subreddit,
      mode: request.mode,
      linksAllowed: request.linksAllowed,
      words,
      shape,
      variationHint,
      post: { title: request.post.title, body: request.post.body },
      suggestedAngle: request.suggestedAngle,
      fixes,
    });
    const result = await ai.object({
      task: 'draft',
      system,
      prompt,
      schema: draftWire,
      maxOutputTokens: 900,
      subject: {
        postIds: [request.post.id],
        productName: request.profile.name,
        productUrl: request.profile.url,
        mode: request.mode,
        linksAllowed: request.linksAllowed,
      },
    });
    if (!result.ok) return { ok: false, kind: result.kind, message: result.message };
    const output = normalizeDraft(result.value);
    const failures = checkDraft(output, checkContext);
    last = { ok: true, output, failures, model: result.model.model };
    if (failures.length === 0) return last;
    fixes = failures;
  }
  return last ?? { ok: false, kind: 'invalid_output', message: 'No draft was produced' };
}
