/**
 * Output contracts for every AI task.
 *
 * Each task has a wire schema, sent to the model as structured-output JSON
 * Schema, and a normaliser that applies the contract's limits. Wire schemas
 * use only types, enums and required fields because providers accept
 * different subsets of JSON Schema; lengths, counts and numeric ranges are
 * enforced here by truncating and clamping, so a reason that runs a little
 * long does not throw away an otherwise valid answer.
 */
import { z } from 'zod';

/**
 * Shortens text to max characters. It ends on a whole sentence when one ends
 * late enough, otherwise on a whole word, so a cut never lands mid-word.
 */
export function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const head = trimmed.slice(0, max - 1);
  const floor = Math.floor(max * 0.6);
  const sentenceEnd = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('! '),
    head.lastIndexOf('? '),
  );
  if (sentenceEnd >= floor) return head.slice(0, sentenceEnd + 1);
  const wordEnd = head.lastIndexOf(' ');
  const cut = wordEnd >= floor ? head.slice(0, wordEnd) : head;
  return `${cut.replace(/[\s,;:]+$/, '')}…`;
}

function clipList(items: string[], maxItems: number, maxChars = 200): string[] {
  return items
    .map((item) => clip(item, maxChars))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)));
}

/* Triage ------------------------------------------------------------------ */

export const triageWire = z.object({
  results: z.array(z.object({ id: z.string(), relevant: z.boolean(), why: z.string() })),
});

export interface TriageResult {
  id: string;
  relevant: boolean;
  why: string;
}

export function normalizeTriage(raw: z.output<typeof triageWire>): TriageResult[] {
  return raw.results.map((result) => ({ ...result, why: clip(result.why, 120) }));
}

/* Qualify ----------------------------------------------------------------- */

export const FITS = ['direct', 'soft', 'none'] as const;
export type Fit = (typeof FITS)[number];

export const INTENTS = [
  'asking_for_recommendation',
  'describing_problem',
  'complaining_about_alternative',
  'comparing_options',
  'how_to_question',
  'sharing_experience',
  'venting',
  'own_promotion',
  'hiring_or_job_ad',
  'other',
] as const;
export type Intent = (typeof INTENTS)[number];

export const RISK_FLAGS = [
  'venting',
  'wants_no_tools',
  'author_is_vendor',
  'already_solved',
  'outside_target_market',
  'sub_hostile_to_promotion',
  'low_effort_post',
  'sensitive_topic',
] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];

/** Flags the pipeline adds itself; the model never sets these. */
export type InternalFlag = 'unverified_quote' | 'busy_thread';

export const qualifyWire = z.object({
  fit: z.enum(FITS),
  intent: z.enum(INTENTS),
  score: z.number(),
  reason: z.string(),
  evidence_quote: z.string(),
  mention_ok: z.boolean(),
  dm_ok: z.boolean(),
  suggested_angle: z.string(),
  risk_flags: z.array(z.enum(RISK_FLAGS)),
  alternatives_mentioned: z.array(z.string()),
});

/** Several posts judged in one call: one result per post, keyed by its id. */
export const qualifyBatchWire = z.object({
  results: z.array(qualifyWire.extend({ id: z.string() })),
});

export interface QualifyResult {
  fit: Fit;
  intent: Intent;
  score: number;
  reason: string;
  evidenceQuote: string;
  mentionOk: boolean;
  dmOk: boolean;
  suggestedAngle: string;
  riskFlags: RiskFlag[];
  alternativesMentioned: string[];
}

export function normalizeQualify(raw: z.output<typeof qualifyWire>): QualifyResult {
  return {
    fit: raw.fit,
    intent: raw.intent,
    score: clampScore(raw.score),
    reason: clip(raw.reason, 240),
    evidenceQuote: clip(raw.evidence_quote, 200),
    mentionOk: raw.mention_ok,
    dmOk: raw.dm_ok,
    suggestedAngle: clip(raw.suggested_angle, 200),
    riskFlags: [...new Set(raw.risk_flags)],
    alternativesMentioned: clipList(raw.alternatives_mentioned, 5, 80),
  };
}

/* Draft ------------------------------------------------------------------- */

export const draftWire = z.object({
  reply: z.string(),
  mentions_product: z.boolean(),
  includes_link: z.boolean(),
  notes_for_user: z.string(),
});

export interface DraftOutput {
  reply: string;
  mentionsProduct: boolean;
  includesLink: boolean;
  notesForUser: string;
}

export function normalizeDraft(raw: z.output<typeof draftWire>): DraftOutput {
  return {
    reply: raw.reply.trim(),
    mentionsProduct: raw.mentions_product,
    includesLink: raw.includes_link,
    notesForUser: clip(raw.notes_for_user, 200),
  };
}

/* Review ------------------------------------------------------------------ */

export const REVIEW_DECISIONS = ['APPROVE', 'REVISE', 'REJECT'] as const;
export type ReviewVerdict = (typeof REVIEW_DECISIONS)[number];

export const reviewWire = z.object({
  decision: z.enum(REVIEW_DECISIONS),
  reasons: z.array(z.string()),
  fixes: z.array(z.string()),
});

export interface ReviewOutput {
  decision: ReviewVerdict;
  reasons: string[];
  fixes: string[];
}

export function normalizeReview(raw: z.output<typeof reviewWire>): ReviewOutput {
  return {
    decision: raw.decision,
    reasons: clipList(raw.reasons, 6, 400),
    fixes: clipList(raw.fixes, 6, 400),
  };
}

/* Product profile --------------------------------------------------------- */

export const PRODUCT_TYPES = [
  'saas',
  'mobile_app',
  'developer_tool',
  'service',
  'physical_product',
  'content',
  'other',
] as const;
export const AUDIENCES = ['consumers', 'businesses', 'developers', 'mixed'] as const;

export const profileWire = z.object({
  name: z.string(),
  product_type: z.enum(PRODUCT_TYPES),
  audience: z.enum(AUDIENCES),
  one_liner: z.string(),
  what_it_does: z.array(z.string()),
  who_it_is_for: z.array(z.string()),
  problems_solved: z.array(z.string()),
  not_for: z.array(z.string()),
  pricing: z.string(),
  alternatives: z.array(z.string()),
  buyer_phrases: z.array(z.string()),
  open_questions: z.array(z.string()),
});

export type ExtractedProfile = z.output<typeof profileWire>;

export function normalizeProfile(raw: ExtractedProfile): ExtractedProfile {
  return {
    name: clip(raw.name, 80),
    product_type: raw.product_type,
    audience: raw.audience,
    one_liner: clip(raw.one_liner, 160),
    what_it_does: clipList(raw.what_it_does, 6),
    who_it_is_for: clipList(raw.who_it_is_for, 5),
    problems_solved: clipList(raw.problems_solved, 8),
    not_for: clipList(raw.not_for, 8),
    pricing: clip(raw.pricing, 160),
    alternatives: clipList(raw.alternatives, 8, 80),
    buyer_phrases: clipList(raw.buyer_phrases, 15, 120),
    open_questions: clipList(raw.open_questions, 5),
  };
}

/* Subreddit rules --------------------------------------------------------- */

export const rulesSummaryWire = z.object({
  promotion: z.enum(['allowed', 'restricted', 'forbidden', 'unclear']),
  links: z.enum(['allowed', 'forbidden', 'unclear']),
  notes: z.array(z.string()),
});

export type RulesSummary = z.output<typeof rulesSummaryWire>;

export function normalizeRulesSummary(raw: RulesSummary): RulesSummary {
  return { ...raw, notes: clipList(raw.notes, 6) };
}

/* Subreddit suggestions --------------------------------------------------- */

export const STRICTNESS = ['lenient', 'moderate', 'strict', 'unknown'] as const;

export const subredditSuggestionsWire = z.object({
  suggestions: z.array(
    z.object({ name: z.string(), reason: z.string(), promotion_strictness: z.enum(STRICTNESS) }),
  ),
});

export interface SubredditSuggestion {
  name: string;
  reason: string;
  promotionStrictness: (typeof STRICTNESS)[number];
}

export function normalizeSubredditSuggestions(
  raw: z.output<typeof subredditSuggestionsWire>,
  max: number,
): SubredditSuggestion[] {
  const seen = new Set<string>();
  const suggestions: SubredditSuggestion[] = [];
  for (const item of raw.suggestions) {
    const name = item.name
      .trim()
      .replace(/^\/?r\//i, '')
      .toLowerCase();
    if (!/^[a-z0-9_]{2,21}$/.test(name) || seen.has(name)) continue;
    seen.add(name);
    suggestions.push({
      name,
      reason: clip(item.reason, 160),
      promotionStrictness: item.promotion_strictness,
    });
  }
  return suggestions.slice(0, max);
}
