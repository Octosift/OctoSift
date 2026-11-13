/** Stage 2: a careful judgement of one post with the full profile. */
import type { ProductProfile } from '../../profile/types';
import {
  bulletList,
  describeAge,
  fence,
  notForText,
  profileText,
  untrustedNotice,
  type PromptParts,
} from './shared';

export interface FeedbackExample {
  title: string;
  reason: string;
}

export interface FeedbackContext {
  rules: string[];
  good: FeedbackExample[];
  bad: FeedbackExample[];
}

export interface QualifyInput {
  profile: ProductProfile;
  rulesSummary: string | null;
  feedback: FeedbackContext;
  post: { subreddit: string; ageSeconds: number; title: string; body: string };
}

function examples(items: FeedbackExample[]): string {
  return bulletList(
    items.map((item) => `"${item.title}": ${item.reason}`),
    '(none yet)',
  );
}

export function buildQualifyPrompt(input: QualifyInput): PromptParts {
  const { profile, rulesSummary, feedback, post } = input;
  const system = [
    'You help a founder decide whether to reply to a Reddit post.',
    `PRODUCT PROFILE\n${profileText(profile)}`,
    `THE PRODUCT DOES NOT HELP WITH\n${notForText(profile)}`,
    `SUBREDDIT RULES\n${rulesSummary ?? 'Unknown. Assume the subreddit dislikes promotion.'}`,
    [
      'WHAT THE FOUNDER TOLD US ABOUT PAST LEADS',
      bulletList(feedback.rules, '(no notes yet)'),
      `Leads the founder marked as good:\n${examples(feedback.good)}`,
      `Leads the founder marked as bad:\n${examples(feedback.bad)}`,
    ].join('\n'),
    [
      'Decide:',
      '- fit: "direct" when the author asks for, or clearly needs, what the product does.',
      '  "soft" when the product is related and a helpful reply could mention it naturally.',
      '  "none" when the product would not help with what the author actually wants.',
      '- score from 0 to 100:',
      '  90-100 the author asks for exactly this kind of product',
      '  75-89  the author describes the problem the product solves and is open to solutions',
      '  60-74  a related problem; a helpful answer could mention the product once',
      '  30-59  on topic, but mentioning the product would feel forced',
      '  0-29   not an opportunity',
      '- evidence_quote: the sentence from the post that best supports your decision, copied word for word.',
      '- mention_ok: false when the author is venting, asked for no tool suggestions, or the',
      '  subreddit rules forbid promotion. A helpful reply without the product may still be possible.',
      '- dm_ok: true only when the author explicitly invites direct messages or asks to be contacted.',
      '- suggested_angle: one sentence on how a genuinely helpful reply would approach this post.',
      '- reason: under 240 characters, written for the founder.',
      '',
      'Judge what the author wants, not which keywords appear. When unsure, choose the lower score.',
    ].join('\n'),
    untrustedNotice('post', 'a Reddit user'),
  ].join('\n\n');

  const prompt = fence('post', `Title: ${post.title}\nBody: ${post.body || '(no text)'}`, {
    subreddit: `r/${post.subreddit}`,
    age: describeAge(post.ageSeconds),
  });

  return { system, prompt };
}
