/** Builds a product profile from the product's own website. */
import { fence, untrustedNotice, type PromptParts } from './shared';

export interface ProfileSourcePage {
  url: string;
  text: string;
}

export interface ProfileExtractInput {
  url: string;
  pages: ProfileSourcePage[];
  /** Used when the site could not be read. */
  description: string | null;
}

export function buildProfileExtractPrompt(input: ProfileExtractInput): PromptParts {
  const system = [
    'You write a factual profile of a product so that a later step can recognise Reddit',
    'posts from people the product could help. Use only what the material says. When',
    'something is not stated, leave the list empty or write "not stated" rather than guessing.',
    '',
    'Fields:',
    '- name, product_type, audience, one_liner (under 160 characters).',
    '- what_it_does (up to 6), who_it_is_for (up to 5), problems_solved (up to 8).',
    '- not_for (up to 8): things people might expect the product to do that it does not,',
    '  and audiences it does not serve. This field matters most; be specific.',
    '- pricing (under 160 characters).',
    '- alternatives (up to 8): kinds of tools or approaches people use instead.',
    '- buyer_phrases (up to 15): words a person with the problem would write in a post,',
    '  not the marketing words from the website.',
    '- open_questions (up to 5): what you would need to ask the founder to fill the gaps.',
    '',
    untrustedNotice('page', 'the product website or the founder'),
  ].join('\n');

  const material =
    input.pages.length > 0
      ? input.pages.map((page) => fence('page', page.text, { url: page.url })).join('\n\n')
      : fence('page', input.description ?? '(no description given)', { url: input.url });

  return { system, prompt: `Product URL: ${input.url}\n\n${material}` };
}
