/** Stage 3: a reply (or private message) in the founder's own voice. */
import type { ReplyMode } from '../../db/schema';
import type { ProductProfile } from '../../profile/types';
import { bulletList, fence, profileText, untrustedNotice, type PromptParts } from './shared';

export interface DraftInput {
  kind: 'reply' | 'dm';
  profile: ProductProfile;
  subreddit: string;
  mode: ReplyMode;
  linksAllowed: boolean;
  words: { min: number; max: number };
  /** The length in plain terms, such as "Two to four sentences". */
  shape?: string;
  variationHint: string;
  post: { title: string; body: string };
  suggestedAngle: string;
  /** Corrections from a failed check or a REVISE review. */
  fixes: string[];
}

function modeRule(mode: ReplyMode, name: string): string {
  switch (mode) {
    case 'helpful_only':
      return `Mode: helpful_only. Do not mention ${name} or any product you are connected to.`;
    case 'soft_mention':
      return (
        'Mode: soft_mention. Answer the question first. Then add one sentence that mentions ' +
        `${name} and says plainly that you built it.`
      );
    case 'direct':
      return (
        `Mode: direct. The author asked for a recommendation. Lead with ${name}, say plainly ` +
        'that you built it, then explain why it fits their situation and where it does not.'
      );
  }
}

function linkRule(linksAllowed: boolean, url: string): string {
  return linksAllowed
    ? `Links are allowed here. If you mention the product you may include ${url} once.`
    : 'Links are not allowed here. If you mention the product, name it without a URL.';
}

export function buildDraftPrompt(input: DraftInput): PromptParts {
  const { profile, mode, kind } = input;
  const what =
    kind === 'reply'
      ? `Write a Reddit comment replying to the post below, for the founder of ${profile.name} to post from their own account.`
      : `Write a short private message to the author of the post below, from the founder of ${profile.name}. The author invited messages.`;

  const system = [
    what,
    [
      'VOICE',
      `First person, as the founder. Plain, specific and conversational. Match the tone of r/${input.subreddit}.`,
      'No greeting, no sign-off, no headings, no bullet lists unless the post uses them,',
      'no em dashes or en dashes, no marketing words.',
    ].join('\n'),
    [
      'RULES',
      '1. Answer what the author actually asked before anything else. The reply must still be',
      '   useful if every sentence about the product were removed.',
      `2. ${modeRule(mode, profile.name)}`,
      '3. If you mention the product, say plainly that you built it (for example "I\'m the',
      '   maker of ..."), and mention it only once.',
      '4. Use only facts from the product profile. Do not invent results, numbers, customers,',
      '   personal stories or comparisons. Never claim to be a customer of the product.',
      `5. ${linkRule(input.linksAllowed, profile.url)}`,
      `6. Length: ${input.shape ? `${input.shape} ` : ''}${input.words.min} to ${input.words.max} words.`,
      `7. ${input.variationHint}`,
    ].join('\n'),
    `PRODUCT PROFILE\n${profileText(profile)}`,
    'Set mentions_product and includes_link to describe the text you wrote. Use notes_for_user for anything the founder should check before posting.',
    untrustedNotice('post', 'a Reddit user'),
  ].join('\n\n');

  const parts = [
    fence('post', `Title: ${input.post.title}\nBody: ${input.post.body || '(no text)'}`),
    `SUGGESTED ANGLE\n${input.suggestedAngle || 'Answer the question as helpfully as you can.'}`,
  ];
  if (input.fixes.length > 0) {
    parts.push(`A previous draft was rejected. Fix these problems:\n${bulletList(input.fixes)}`);
  }
  return { system, prompt: parts.join('\n\n') };
}
