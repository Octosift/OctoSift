/**
 * Subreddit rules, pasted by the user, summarised into the policy the
 * pipeline needs: may a reply mention the product, may it link, and which
 * rules a commenter must follow.
 *
 * Reddit's own rules endpoint needs API credentials that new apps can no
 * longer get, so the user pastes the rules from the subreddit's sidebar.
 */
import type { AiClient } from '../ai/client';
import { buildRulesSummaryPrompt } from '../ai/prompts/rules';
import { normalizeRulesSummary, rulesSummaryWire, type RulesSummary } from '../ai/schemas';
import type { Db } from '../db/client';
import { getSubreddit, saveRules, setPromotionPolicy } from '../db/queries/subreddits';
import type { PromotionPolicy } from '../db/schema';

export const RULES_TEXT_LIMITS = { min: 20, max: 20_000 } as const;

export type SummariseRulesResult =
  { ok: true; summary: RulesSummary } | { ok: false; message: string };

export async function summariseRules(
  ai: AiClient,
  input: { subreddit: string; text: string },
): Promise<SummariseRulesResult> {
  const { system, prompt } = buildRulesSummaryPrompt(input.subreddit, input.text);
  const result = await ai.object({
    task: 'rules',
    system,
    prompt,
    schema: rulesSummaryWire,
    maxOutputTokens: 500,
    subject: {},
  });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, summary: normalizeRulesSummary(result.value) };
}

/** The promotion policy a summary implies, when it is clear enough to act on. */
export function policyFromRules(summary: RulesSummary): PromotionPolicy | null {
  if (summary.promotion === 'forbidden') return 'no_promotion';
  if (summary.promotion === 'allowed') return 'allowed';
  return null;
}

/**
 * Stores the pasted rules and their summary. The promotion policy follows the
 * summary only while the user has not chosen one, so their choice always wins.
 */
export function storeRules(
  db: Db,
  input: { subreddit: string; text: string; summary: RulesSummary; now: number },
): void {
  saveRules(db, input.subreddit, { text: input.text, summary: input.summary, now: input.now });
  const current = getSubreddit(db, input.subreddit)?.promotionPolicy ?? 'unknown';
  const implied = policyFromRules(input.summary);
  if (current === 'unknown' && implied) setPromotionPolicy(db, input.subreddit, implied);
}
