/**
 * Turns crawled pages (or a pasted description) into a product profile, and
 * merges the founder's interview answers into it.
 *
 * The short profile used by triage is built in code from the profile's own
 * fields: it is free, deterministic, and cannot drift from the full profile.
 */
import type { AiClient } from '../ai/client';
import { buildProfileExtractPrompt, type ProfileExtractInput } from '../ai/prompts/profile';
import { normalizeProfile, profileWire, type ExtractedProfile } from '../ai/schemas';
import { CONFIG } from '../config';
import type { ProductProfile } from './types';

export type ExtractResult =
  { ok: true; profile: ExtractedProfile } | { ok: false; message: string };

export async function extractProfile(
  ai: AiClient,
  input: ProfileExtractInput,
): Promise<ExtractResult> {
  const { system, prompt } = buildProfileExtractPrompt(input);
  const result = await ai.object({
    task: 'profile',
    system,
    prompt,
    schema: profileWire,
    maxOutputTokens: 2_500,
    subject: { productUrl: input.url },
  });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, profile: normalizeProfile(result.value) };
}

export interface InterviewAnswers {
  bestCustomer?: string;
  misconceptions?: string;
  neverReplyTo?: string;
  includeLinks?: boolean;
  redditUsername?: string;
  openAnswers?: { question: string; answer: string }[];
}

type ShortProfileSource = Pick<
  ProductProfile,
  'name' | 'one_liner' | 'who_it_is_for' | 'problems_solved' | 'not_for' | 'what_it_does'
>;

/** A summary under the word limit, most important parts first. */
export function buildShortProfile(profile: ShortProfileSource): string {
  const parts = [
    `${profile.name}: ${profile.one_liner}`,
    profile.who_it_is_for.length > 0 ? `For: ${profile.who_it_is_for.join('; ')}.` : '',
    profile.problems_solved.length > 0 ? `Solves: ${profile.problems_solved.join('; ')}.` : '',
    profile.not_for.length > 0 ? `Not for: ${profile.not_for.join('; ')}.` : '',
    profile.what_it_does.length > 0 ? `Does: ${profile.what_it_does.join('; ')}.` : '',
  ].filter((part) => part.length > 0);
  const words = parts.join(' ').split(/\s+/);
  const limit = CONFIG.profile.shortMaxWords;
  return words.length <= limit ? words.join(' ') : `${words.slice(0, limit - 1).join(' ')} …`;
}

function cleanUsername(raw: string | undefined): string | null {
  const name = (raw ?? '').trim().replace(/^\/?u\//i, '');
  return name.length > 0 ? name : null;
}

export function mergeInterview(
  extracted: ExtractedProfile,
  url: string,
  answers: InterviewAnswers,
): ProductProfile {
  const merged: ProductProfile = {
    ...extracted,
    url,
    best_customer: answers.bestCustomer?.trim() ?? '',
    misconceptions: answers.misconceptions?.trim() ?? '',
    never_reply_to: answers.neverReplyTo?.trim() ?? '',
    include_links: answers.includeLinks ?? true,
    reddit_username: cleanUsername(answers.redditUsername),
    founder_notes: (answers.openAnswers ?? [])
      .filter((item) => item.answer.trim().length > 0)
      .map((item) => `${item.question.trim()} ${item.answer.trim()}`),
    short: '',
  };
  return { ...merged, short: buildShortProfile(merged) };
}
