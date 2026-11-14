/**
 * Stage 2: a careful judgement of one post with the full profile.
 *
 * The model must quote the sentence that supports its decision. Models
 * sometimes paraphrase, which makes the quote useless as evidence, so the
 * quote is checked against the post; when it is missing the result gets an
 * internal `unverified_quote` flag, which the score stage penalises.
 */
import type { AiClient } from '../ai/client';
import { buildQualifyPrompt, type FeedbackContext } from '../ai/prompts/qualify';
import {
  normalizeQualify,
  qualifyWire,
  type InternalFlag,
  type QualifyResult,
} from '../ai/schemas';
import type { AiFailureKind } from '../ai/types';
import type { ProductProfile } from '../profile/types';

export interface QualifyCandidate {
  id: string;
  subreddit: string;
  title: string;
  bodyText: string;
  createdAt: number;
  score?: number | null;
  commentCount?: number | null;
}

export interface QualifyContext {
  profile: ProductProfile;
  rulesSummary: string | null;
  feedback: FeedbackContext;
  now: number;
}

export type QualifyOutcome =
  | { ok: true; result: QualifyResult; internalFlags: InternalFlag[]; model: string }
  | { ok: false; kind: AiFailureKind; message: string; model: string | null };

function normalizeForQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the quote appears in the text, ignoring case, spacing and quote styles. */
export function quoteAppearsIn(quote: string, text: string): boolean {
  const needle = normalizeForQuote(quote)
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/(\.{3}|…)$/u, '')
    .replace(/^(\.{3}|…)/u, '')
    .trim();
  if (needle.length === 0) return false;
  return normalizeForQuote(text).includes(needle);
}

export async function qualifyPost(
  ai: AiClient,
  candidate: QualifyCandidate,
  context: QualifyContext,
): Promise<QualifyOutcome> {
  const { system, prompt } = buildQualifyPrompt({
    profile: context.profile,
    rulesSummary: context.rulesSummary,
    feedback: context.feedback,
    post: {
      subreddit: candidate.subreddit,
      ageSeconds: context.now - candidate.createdAt,
      title: candidate.title,
      body: candidate.bodyText,
      score: candidate.score ?? null,
      commentCount: candidate.commentCount ?? null,
    },
  });
  const response = await ai.object({
    task: 'qualify',
    system,
    prompt,
    schema: qualifyWire,
    maxOutputTokens: 800,
    subject: { postIds: [candidate.id], productName: context.profile.name },
  });
  if (!response.ok) {
    return {
      ok: false,
      kind: response.kind,
      message: response.message,
      model: response.model?.model ?? null,
    };
  }
  const result = normalizeQualify(response.value);
  const verified = quoteAppearsIn(
    result.evidenceQuote,
    `${candidate.title}\n${candidate.bodyText}`,
  );
  return {
    ok: true,
    result,
    internalFlags: verified ? [] : ['unverified_quote'],
    model: response.model.model,
  };
}
