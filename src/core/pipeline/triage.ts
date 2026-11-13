/**
 * Stage 1: screen posts cheaply in batches.
 *
 * A batch answer that fails, or leaves posts out, is retried one post at a
 * time; a post that fails on its own is recorded as a retryable error,
 * never as "not relevant". When the budget runs out, the remaining posts
 * are left retryable and the stage stops.
 */
import type { AiClient } from '../ai/client';
import { buildTriagePrompt, type TriagePost } from '../ai/prompts/triage';
import { normalizeTriage, triageWire } from '../ai/schemas';
import { CONFIG } from '../config';
import type { ProductProfile } from '../profile/types';

export interface TriageCandidate {
  id: string;
  subreddit: string;
  title: string;
  bodyText: string;
}

export type StageOutcome =
  | { verdict: 'pass' | 'skip'; reason: string; model: string }
  | { verdict: 'error'; reason: string; model: string | null; budget: boolean };

export interface TriageRun {
  outcomes: Map<string, StageOutcome>;
  stoppedForBudget: boolean;
}

type BatchAnswer =
  | { ok: true; answers: Map<string, StageOutcome> }
  | { ok: false; outcome: Extract<StageOutcome, { verdict: 'error' }> };

function toTriagePost(candidate: TriageCandidate): TriagePost {
  return {
    id: candidate.id,
    subreddit: candidate.subreddit,
    title: candidate.title,
    excerpt: candidate.bodyText.slice(0, CONFIG.triage.excerptChars),
  };
}

async function askBatch(
  ai: AiClient,
  profile: ProductProfile,
  batch: TriageCandidate[],
): Promise<BatchAnswer> {
  const { system, prompt } = buildTriagePrompt(profile, batch.map(toTriagePost));
  const result = await ai.object({
    task: 'triage',
    system,
    prompt,
    schema: triageWire,
    maxOutputTokens: 200 + 80 * batch.length,
    subject: { postIds: batch.map((post) => post.id), productName: profile.name },
  });
  if (!result.ok) {
    return {
      ok: false,
      outcome: {
        verdict: 'error',
        reason: result.message,
        model: result.model?.model ?? null,
        budget: result.kind === 'budget',
      },
    };
  }
  const wanted = new Set(batch.map((post) => post.id));
  const answers = new Map<string, StageOutcome>();
  for (const answer of normalizeTriage(result.value)) {
    if (!wanted.has(answer.id) || answers.has(answer.id)) continue;
    answers.set(answer.id, {
      verdict: answer.relevant ? 'pass' : 'skip',
      reason: answer.why || (answer.relevant ? 'Possibly relevant' : 'Not relevant'),
      model: result.model.model,
    });
  }
  return { ok: true, answers };
}

export async function triagePosts(
  ai: AiClient,
  profile: ProductProfile,
  posts: TriageCandidate[],
  batchSize: number = CONFIG.triage.batchSize,
): Promise<TriageRun> {
  const outcomes = new Map<string, StageOutcome>();
  let budgetStop: Extract<StageOutcome, { verdict: 'error' }> | null = null;

  for (let start = 0; start < posts.length; start += batchSize) {
    const batch = posts.slice(start, start + batchSize);
    if (budgetStop) {
      for (const post of batch) outcomes.set(post.id, budgetStop);
      continue;
    }
    const answer = await askBatch(ai, profile, batch);
    if (!answer.ok && answer.outcome.budget) {
      budgetStop = answer.outcome;
      for (const post of batch) outcomes.set(post.id, budgetStop);
      continue;
    }
    for (const post of batch) {
      const found = answer.ok ? answer.answers.get(post.id) : undefined;
      if (found) {
        outcomes.set(post.id, found);
        continue;
      }
      if (budgetStop) {
        outcomes.set(post.id, budgetStop);
        continue;
      }
      const single = await askBatch(ai, profile, [post]);
      const outcome = single.ok
        ? (single.answers.get(post.id) ?? {
            verdict: 'error' as const,
            reason: 'The model did not answer for this post',
            model: null,
            budget: false,
          })
        : single.outcome;
      if (outcome.verdict === 'error' && outcome.budget) budgetStop = outcome;
      outcomes.set(post.id, outcome);
    }
  }
  return { outcomes, stoppedForBudget: budgetStop !== null };
}
