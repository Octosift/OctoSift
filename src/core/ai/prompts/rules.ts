/** Summarises a subreddit's rules into the policy the pipeline needs. */
import { fence, untrustedNotice, type PromptParts } from './shared';

export function buildRulesSummaryPrompt(subreddit: string, rulesText: string): PromptParts {
  const system = [
    `Summarise the rules of r/${subreddit} for someone who wants to reply helpfully and,`,
    'when allowed, mention a product they built.',
    '',
    '- promotion: "allowed" when self-promotion is fine, "restricted" when it is limited',
    '  (for example only in a weekly thread or with disclosure), "forbidden" when it is',
    '  banned, "unclear" when the rules do not say.',
    '- links: "allowed", "forbidden" or "unclear".',
    '- notes: up to 6 short rules a commenter must follow.',
    '',
    untrustedNotice('rules', 'the subreddit'),
  ].join('\n');
  return { system, prompt: fence('rules', rulesText) };
}
