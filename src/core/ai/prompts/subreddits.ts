/** Suggests subreddits where the product's customers ask questions. */
import type { ProductProfile } from '../../profile/types';
import { notForText, profileText, type PromptParts } from './shared';

export function buildSubredditSuggestionPrompt(profile: ProductProfile, max: number): PromptParts {
  const system = [
    `Suggest up to ${max} subreddits where the people described below ask questions or`,
    'describe the problems this product solves. Prefer active communities of the people who',
    'have the problem over communities about the product category or for vendors.',
    '',
    'For each, give the name without "r/", a one-line reason, and a guess at how strict the',
    'community is about promotion: lenient, moderate, strict or unknown.',
    '',
    'Only suggest subreddits you are confident exist.',
  ].join('\n');
  const prompt = [
    `PRODUCT PROFILE\n${profileText(profile)}`,
    `NOT FOR\n${notForText(profile)}`,
  ].join('\n\n');
  return { system, prompt };
}
