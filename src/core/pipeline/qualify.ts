/**
 * Stage 2: a careful judgement of one post with the full profile.
 *
 * The model must quote the sentence that supports its decision. Models
 * sometimes paraphrase, which makes the quote useless as evidence, so the
 * quote is checked against the post; when it is missing the result gets an
 * internal `unverified_quote` flag, which the score stage penalises.
 */
import type { AiClient } from '../ai/client';
import {
  buildQualifyBatchPrompt,
  buildQualifyPrompt,
  type FeedbackContext,
} from '../ai/prompts/qualify';
import {
  normalizeQualify,
  qualifyBatchWire,
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

/**
 * Judges several posts from one subreddit in one call, for providers with a
 * large cost per call. Each post gets its own outcome; a post the model left
 * out is a retryable error, picked up again by the next scan.
 */
export async function qualifyPosts(
  ai: AiClient,
  candidates: QualifyCandidate[],
  context: QualifyContext,
): Promise<Map<string, QualifyOutcome>> {
  const { system, prompt } = buildQualifyBatchPrompt({
    profile: context.profile,
    rulesSummary: context.rulesSummary,
    feedback: context.feedback,
    posts: candidates.map((candidate) => ({
      id: candidate.id,
      subreddit: candidate.subreddit,
      ageSeconds: context.now - candidate.createdAt,
      title: candidate.title,
      body: candidate.bodyText,
      score: candidate.score ?? null,
      commentCount: candidate.commentCount ?? null,
    })),
  });
  const response = await ai.object({
    task: 'qualify',
    system,
    prompt,
    schema: qualifyBatchWire,
    maxOutputTokens: 800 * candidates.length,
    subject: {
      postIds: candidates.map((candidate) => candidate.id),
      productName: context.profile.name,
    },
  });
  const outcomes = new Map<string, QualifyOutcome>();
  if (!response.ok) {
    const failure: QualifyOutcome = {
      ok: false,
      kind: response.kind,
      message: response.message,
      model: response.model?.model ?? null,
    };
    for (const candidate of candidates) outcomes.set(candidate.id, failure);
    return outcomes;
  }
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const { id, ...raw } of response.value.results) {
    const candidate = byId.get(id);
    if (!candidate || outcomes.has(id)) continue;
    const result = normalizeQualify(raw);
    const verified = quoteAppearsIn(
      result.evidenceQuote,
      `${candidate.title}\n${candidate.bodyText}`,
    );
    outcomes.set(id, {
      ok: true,
      result,
      internalFlags: verified ? [] : ['unverified_quote'],
      model: response.model.model,
    });
  }
  for (const candidate of candidates) {
    if (!outcomes.has(candidate.id)) {
      outcomes.set(candidate.id, {
        ok: false,
        kind: 'invalid_output',
        message: 'The model did not answer for this post',
        model: response.model.model,
      });
    }
  }
  return outcomes;
}
