/** Stage 1: a cheap, generous screen over a batch of posts. */
import type { ProductProfile } from '../../profile/types';
import { fence, notForText, untrustedNotice, type PromptParts } from './shared';

export interface TriagePost {
  id: string;
  subreddit: string;
  title: string;
  excerpt: string;
}

export function buildTriagePrompt(profile: ProductProfile, posts: TriagePost[]): PromptParts {
  const system = [
    'You screen Reddit posts for a founder who is looking for people their product could help.',
    `PRODUCT\n${profile.short}`,
    `WHAT THE PRODUCT DOES NOT DO\n${notForText(profile)}`,
    [
      'For each post, decide whether the author has a problem, question or request that this',
      'product could plausibly help with. Be generous: a later step reviews every post you keep.',
      'Mark as not relevant: announcements, memes, job ads, authors promoting their own product,',
      'and topics the product does not cover.',
    ].join('\n'),
    'Return exactly one result per post, using each post id exactly as given. Keep "why" under 120 characters.',
    untrustedNotice('post', 'Reddit users'),
  ].join('\n\n');

  const prompt = posts
    .map((post) =>
      fence('post', `Title: ${post.title}\nExcerpt: ${post.excerpt || '(no text)'}`, {
        id: post.id,
        subreddit: `r/${post.subreddit}`,
      }),
    )
    .join('\n\n');

  return { system, prompt };
}
