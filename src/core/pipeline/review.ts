/**
 * Stage 4: a second model reviews each draft as a moderator would.
 *
 * APPROVE keeps the draft. REVISE or REJECT triggers one regeneration with
 * the reviewer's fixes, followed by a second review. A draft rejected twice
 * is not stored; the lead stays, with the reasons. When the reviewer itself
 * fails, the draft is kept and labelled as not reviewed.
 */
import type { AiClient } from '../ai/client';
import { buildReviewPrompt } from '../ai/prompts/review';
import { normalizeReview, reviewWire, type DraftOutput, type ReviewOutput } from '../ai/schemas';
import type { AiFailureKind } from '../ai/types';
import type { ReviewDecision } from '../db/schema';
import { writeDraft, type DraftRequest } from './draft';

export interface ReviewRequest {
  profile: DraftRequest['profile'];
  subreddit: string;
  rulesSummary: string | null;
  post: { id: string; title: string; body: string };
  draft: string;
}

export type ReviewResult =
  | { ok: true; review: ReviewOutput; model: string }
  | { ok: false; kind: AiFailureKind; message: string };

export async function reviewDraft(ai: AiClient, request: ReviewRequest): Promise<ReviewResult> {
  const { system, prompt } = buildReviewPrompt({
    profile: request.profile,
    subreddit: request.subreddit,
    rulesSummary: request.rulesSummary,
    post: { title: request.post.title, body: request.post.body },
    draft: request.draft,
  });
  const result = await ai.object({
    task: 'review',
    system,
    prompt,
    schema: reviewWire,
    maxOutputTokens: 600,
    subject: { postIds: [request.post.id], productName: request.profile.name },
  });
  if (!result.ok) return { ok: false, kind: result.kind, message: result.message };
  return { ok: true, review: normalizeReview(result.value), model: result.model.model };
}

export type ReplyOutcome =
  | {
      status: 'drafted';
      draft: DraftOutput;
      /** Deterministic check failures left after regeneration. */
      failures: string[];
      decision: Exclude<ReviewDecision, 'REJECT'>;
      reasons: string[];
      attempts: number;
    }
  | { status: 'rejected'; reasons: string[]; attempts: number }
  | { status: 'failed'; kind: AiFailureKind; message: string };

export async function writeReviewedReply(
  ai: AiClient,
  request: DraftRequest & { rulesSummary: string | null },
): Promise<ReplyOutcome> {
  const review = (draft: DraftOutput) =>
    reviewDraft(ai, {
      profile: request.profile,
      subreddit: request.subreddit,
      rulesSummary: request.rulesSummary,
      post: request.post,
      draft: draft.reply,
    });

  const first = await writeDraft(ai, request);
  if (!first.ok) return { status: 'failed', kind: first.kind, message: first.message };
  const firstReview = await review(first.output);
  if (!firstReview.ok) {
    return {
      status: 'drafted',
      draft: first.output,
      failures: first.failures,
      decision: 'NOT_REVIEWED',
      reasons: [firstReview.message],
      attempts: 1,
    };
  }
  if (firstReview.review.decision === 'APPROVE') {
    return {
      status: 'drafted',
      draft: first.output,
      failures: first.failures,
      decision: 'APPROVE',
      reasons: firstReview.review.reasons,
      attempts: 1,
    };
  }

  const fixes = [...firstReview.review.fixes, ...firstReview.review.reasons];
  const second = await writeDraft(ai, { ...request, fixes });
  if (!second.ok) {
    return firstReview.review.decision === 'REVISE'
      ? {
          status: 'drafted',
          draft: first.output,
          failures: first.failures,
          decision: 'REVISE',
          reasons: firstReview.review.reasons,
          attempts: 1,
        }
      : { status: 'rejected', reasons: firstReview.review.reasons, attempts: 1 };
  }
  const secondReview = await review(second.output);
  if (!secondReview.ok) {
    return {
      status: 'drafted',
      draft: second.output,
      failures: second.failures,
      decision: 'NOT_REVIEWED',
      reasons: [secondReview.message],
      attempts: 2,
    };
  }
  if (secondReview.review.decision === 'REJECT') {
    return { status: 'rejected', reasons: secondReview.review.reasons, attempts: 2 };
  }
  return {
    status: 'drafted',
    draft: second.output,
    failures: second.failures,
    decision: secondReview.review.decision,
    reasons: secondReview.review.reasons,
    attempts: 2,
  };
}
