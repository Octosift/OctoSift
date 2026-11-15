/**
 * Writes and stores the drafts for one lead: a reply, and a private message
 * when the author invited one and the product allows them. Used by scans for
 * strong leads and by the dashboard when the user asks for a draft.
 */
import type { AiClient } from '../ai/client';
import type { Fit, Intent, RulesSummary } from '../ai/schemas';
import type { Random } from '../clock';
import type { DraftKind, ReplyLength, ReplyMode } from '../db/schema';
import { newId } from '../ids';
import type { Logger } from '../log';
import type { ProductProfile } from '../profile/types';
import { chooseMode, type DraftStep } from './draft';
import { writeReviewedReply } from './review';
import type { ScanStore } from './store';

export interface DraftDeps {
  ai: AiClient;
  store: ScanStore;
  random: Random;
  log: Logger;
  now: number;
  /** Called as each draft is written, fixed and reviewed. */
  onStep?: (kind: DraftKind, step: DraftStep) => void;
}

export interface LeadDraftInput {
  leadId: string;
  /** The most promotional reply mode the founder allows for the product. */
  allowedMode: ReplyMode;
  profile: ProductProfile;
  post: { id: string; subreddit: string; title: string; bodyText: string };
  qualify: { fit: Fit; intent: Intent; mentionOk: boolean; dmOk: boolean; suggestedAngle: string };
  rules: RulesSummary | null;
  replyPreferences: { includeLinks: boolean; dmDrafts: boolean | null; length: ReplyLength };
  /** Set when the user picks a mode in the draft editor. */
  modeOverride?: ReplyMode;
  /** Set when the user picks a length in the draft editor. */
  lengthOverride?: ReplyLength;
  /** Extra guidance typed by the user when regenerating. */
  instruction?: string;
  kinds?: DraftKind[];
  /** False keeps the lead's status, for leads already replied to or snoozed. */
  updateStatus?: boolean;
}

export type DraftStatus = 'drafted' | 'rejected' | 'failed' | 'skipped';

export interface LeadDraftResult {
  reply: DraftStatus;
  dm: DraftStatus;
  /** Why the reply could not be written, for the lead's detail panel. */
  message: string | null;
  /** Set when the budget refused a call; a scan then stops its AI work. */
  budgetStop: string | null;
}

export function formatRules(rules: RulesSummary | null): string | null {
  if (!rules) return null;
  const notes = rules.notes.length > 0 ? ` Notes: ${rules.notes.join('; ')}.` : '';
  return `Promotion: ${rules.promotion}. Links: ${rules.links}.${notes}`;
}

export function dmDraftsEnabled(profile: ProductProfile, preference: boolean | null): boolean {
  return preference ?? profile.audience !== 'consumers';
}

export async function draftForLead(
  deps: DraftDeps,
  input: LeadDraftInput,
): Promise<LeadDraftResult> {
  const mode =
    input.modeOverride ??
    chooseMode({
      allowed: input.allowedMode,
      fit: input.qualify.fit,
      intent: input.qualify.intent,
      mentionOk: input.qualify.mentionOk,
    });
  const linksAllowed =
    input.profile.include_links &&
    input.replyPreferences.includeLinks &&
    input.rules?.links === 'allowed';
  const wantsDm =
    input.qualify.dmOk &&
    mode !== 'helpful_only' &&
    dmDraftsEnabled(input.profile, input.replyPreferences.dmDrafts);
  const kinds = input.kinds ?? (wantsDm ? ['reply', 'dm'] : ['reply']);
  const result: LeadDraftResult = {
    reply: 'skipped',
    dm: 'skipped',
    message: null,
    budgetStop: null,
  };

  const length = input.lengthOverride ?? input.replyPreferences.length;
  for (const kind of kinds) {
    const outcome = await writeReviewedReply(
      deps.ai,
      {
        kind,
        profile: input.profile,
        subreddit: input.post.subreddit,
        mode: kind === 'dm' && mode === 'helpful_only' ? 'soft_mention' : mode,
        length,
        linksAllowed,
        post: { id: input.post.id, title: input.post.title, body: input.post.bodyText },
        suggestedAngle: input.qualify.suggestedAngle,
        fixes: input.instruction ? [input.instruction] : [],
        random: deps.random,
        rulesSummary: formatRules(input.rules),
      },
      (step) => deps.onStep?.(kind, step),
    );
    if (outcome.status === 'drafted') {
      deps.store.insertDraft({
        id: newId(),
        leadId: input.leadId,
        kind,
        text: outcome.draft.reply,
        mode,
        length: kind === 'reply' ? length : null,
        mentionsProduct: outcome.draft.mentionsProduct,
        includesLink: outcome.draft.includesLink,
        notesForUser: outcome.draft.notesForUser,
        needsEdit: outcome.failures.length > 0 || outcome.decision === 'REVISE',
        checkFailuresJson: outcome.failures,
        reviewDecision: outcome.decision,
        reviewReasonsJson: outcome.reasons,
        editedByUser: false,
        createdAt: deps.now,
      });
    }
    const status: DraftStatus = outcome.status;
    if (kind === 'reply') {
      result.reply = status;
      if (outcome.status === 'rejected') {
        result.message = `Could not write a reply that passes review: ${outcome.reasons.join(' ')}`;
      } else if (outcome.status === 'failed') {
        result.message = `Could not write a reply: ${outcome.message}`;
      }
    } else {
      result.dm = status;
    }
    if (outcome.status === 'failed') {
      deps.log.warn('Drafting failed', { leadId: input.leadId, kind, reason: outcome.message });
    }
    if (outcome.budgetStop !== null) {
      result.budgetStop = outcome.budgetStop;
      break;
    }
  }

  if (result.reply === 'drafted') {
    const status = input.updateStatus === false ? {} : { status: 'drafted' as const };
    deps.store.updateLead(input.leadId, { ...status, draftError: null }, deps.now);
  } else if (result.message !== null) {
    deps.store.updateLead(input.leadId, { draftError: result.message }, deps.now);
  }
  return result;
}
