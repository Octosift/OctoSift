/** Display helpers for leads, shared by server and client components. */

export const INTENT_LABELS: Record<string, string> = {
  asking_for_recommendation: 'Asks for a tool',
  describing_problem: 'Describes a problem',
  complaining_about_alternative: 'Unhappy with an alternative',
  comparing_options: 'Comparing options',
  how_to_question: 'How-to question',
  sharing_experience: 'Sharing experience',
  venting: 'Venting',
  own_promotion: 'Self-promotion',
  hiring_or_job_ad: 'Job ad',
  other: 'Other',
};

export function intentLabel(intent: string): string {
  return INTENT_LABELS[intent] ?? intent;
}

export const RISK_LABELS: Record<string, string> = {
  venting: 'Venting',
  wants_no_tools: 'Asked for no tools',
  author_is_vendor: 'Author sells something similar',
  already_solved: 'Already solved',
  outside_target_market: 'Outside your market',
  sub_hostile_to_promotion: 'Subreddit dislikes promotion',
  low_effort_post: 'Low-effort post',
  sensitive_topic: 'Sensitive topic',
  unverified_quote: 'Quote not found in post',
  busy_thread: 'Busy thread: replies get buried',
};

export const MODE_LABELS = {
  helpful_only: 'Helpful only',
  soft_mention: 'Soft mention',
  direct: 'Direct',
} as const;

export type ScoreTone = 'strong' | 'brand' | 'neutral';

export function scoreTone(score: number): ScoreTone {
  if (score >= 85) return 'strong';
  if (score >= 75) return 'brand';
  return 'neutral';
}

export interface Segment {
  text: string;
  highlight: boolean;
}

/**
 * Splits text into segments with the quote marked, matching regardless of
 * case and spacing. Returns one plain segment when the quote is not found.
 */
export function highlightQuote(text: string, quote: string): Segment[] {
  const words = quote
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return [{ text, highlight: false }];
  const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const match = text.matchAll(new RegExp(pattern, 'gi')).next().value;
  if (!match) return [{ text, highlight: false }];
  const start = match.index;
  const end = start + match[0].length;
  return [
    { text: text.slice(0, start), highlight: false },
    { text: text.slice(start, end), highlight: true },
    { text: text.slice(end), highlight: false },
  ].filter((segment) => segment.text.length > 0);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}
