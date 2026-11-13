/**
 * Deterministic rules applied after the qualify stage.
 *
 * Contract: a veto can only lower a result. It can turn a lead into a
 * non-lead, turn mentioning the product off, and add risk flags; it never
 * does the opposite. The model's judgement is advisory where these rules
 * apply, because they encode things the founder or the subreddit decided.
 */
import type { InternalFlag, QualifyResult, RiskFlag } from '../ai/schemas';
import { containsTerm } from './prefilter';

export type PromotionRule = 'allowed' | 'restricted' | 'forbidden' | 'unclear';

export interface VetoInput {
  qualify: QualifyResult;
  internalFlags: readonly InternalFlag[];
  postText: string;
  /** The user marked this subreddit as "no promotion". */
  subredditNoPromotion: boolean;
  /** From the subreddit's rules summary, when known. */
  rulesPromotion: PromotionRule | null;
  vetoPhrases: readonly string[];
}

export interface VetoOutcome {
  lead: boolean;
  /** Why the post is not a lead, or why mentioning the product was turned off. */
  reasons: string[];
  mentionOk: boolean;
  dmOk: boolean;
  flags: (RiskFlag | InternalFlag)[];
}

export function applyVeto(input: VetoInput): VetoOutcome {
  const { qualify } = input;
  const flags = new Set<RiskFlag | InternalFlag>([...qualify.riskFlags, ...input.internalFlags]);
  const reasons: string[] = [];
  let lead = true;
  let mentionOk = qualify.mentionOk;

  if (qualify.fit === 'none') {
    lead = false;
    reasons.push('The product would not help with what the author wants');
  }
  if (flags.has('author_is_vendor')) {
    lead = false;
    reasons.push('The author sells something similar');
  }
  if (qualify.intent === 'hiring_or_job_ad') {
    lead = false;
    reasons.push('Job ad or hiring post');
  }
  if (qualify.intent === 'own_promotion') {
    lead = false;
    reasons.push('The author is promoting their own product');
  }
  const phrase = input.vetoPhrases.find((candidate) => containsTerm(input.postText, candidate));
  if (phrase !== undefined) {
    lead = false;
    reasons.push(`Matches your veto phrase "${phrase}"`);
  }

  if (mentionOk && (flags.has('venting') || flags.has('wants_no_tools'))) {
    mentionOk = false;
    reasons.push('The author is venting or asked for no tool suggestions');
  }
  if (input.subredditNoPromotion || input.rulesPromotion === 'forbidden') {
    flags.add('sub_hostile_to_promotion');
    if (mentionOk) reasons.push('The subreddit does not allow promotion');
    mentionOk = false;
  }

  return {
    lead,
    reasons,
    mentionOk,
    // A private message is about the product, so it needs the same permission.
    dmOk: qualify.dmOk && mentionOk,
    flags: [...flags],
  };
}
