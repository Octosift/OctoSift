/** Stage 4: a second model checks a draft the way a moderator would. */
import type { ProductProfile } from '../../profile/types';
import { fence, profileText, untrustedNotice, type PromptParts } from './shared';

export interface ReviewInput {
  profile: ProductProfile;
  subreddit: string;
  rulesSummary: string | null;
  post: { title: string; body: string };
  draft: string;
}

export function buildReviewPrompt(input: ReviewInput): PromptParts {
  const system = [
    'You review a Reddit reply before the founder posts it. Approve only replies that a',
    `moderator of r/${input.subreddit} would see as a genuine, helpful comment.`,
    '',
    [
      'Check that the reply:',
      "- answers the author's actual question;",
      '- makes no claim about the product that is missing from the product profile;',
      '- contains no invented personal experience, results, numbers or comparisons;',
      '- says clearly that the writer built the product, if it mentions the product;',
      '- follows the subreddit rules below;',
      '- does not read like an advertisement.',
    ].join('\n'),
    '',
    'Return APPROVE, REVISE with specific fixes, or REJECT with the reason.',
    '',
    `SUBREDDIT RULES\n${input.rulesSummary ?? 'Unknown. Be strict about promotion.'}`,
    '',
    `PRODUCT PROFILE\n${profileText(input.profile)}`,
    '',
    untrustedNotice('post', 'a Reddit user'),
    untrustedNotice('reply', 'the draft under review'),
  ].join('\n');

  const prompt = [
    fence('post', `Title: ${input.post.title}\nBody: ${input.post.body || '(no text)'}`),
    fence('reply', input.draft),
  ].join('\n\n');

  return { system, prompt };
}
