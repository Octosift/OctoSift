/**
 * Image posts. When the setting is on, the image of a post is described once
 * by the qualify model and the description is added to the text the models
 * read, as "[IMAGE] …", before triage. Descriptions are cached by image
 * address. Any failure is skipped silently, and after the first one no more
 * images are tried in that scan, so a model that does not accept images costs
 * one call rather than one per post.
 *
 * Only images hosted by Reddit are described, so no other site is contacted.
 */
import { buildImagePrompt } from '../ai/prompts/image';
import { CONFIG } from '../config';
import type { PostRow } from '../db/queries/posts';
import { aiAvailable, type EvaluateContext } from './evaluate-context';
import { countWords } from './draft';

const MARKER = '\n\n[IMAGE] ';

export function isRedditImage(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === 'https:' &&
      (hostname.endsWith('.redd.it') || hostname.endsWith('.redditmedia.com'))
    );
  } catch {
    // A malformed address is not an image we can describe.
    return false;
  }
}

/** The post text with the image description appended. */
export function withImage(body: string, description: string | undefined): string {
  return description ? `${body}${MARKER}${description}` : body;
}

/** The author's own text, without an appended image description. */
export function withoutImage(body: string): string {
  const index = body.lastIndexOf(MARKER);
  return index === -1 ? body : body.slice(0, index);
}

function clipWords(text: string, max: number): string {
  if (countWords(text) <= max) return text;
  return `${text.split(/\s+/).slice(0, max).join(' ')}…`;
}

/** Descriptions for the posts that have a Reddit-hosted image, by post id. */
export async function describeImages(
  ctx: EvaluateContext,
  posts: readonly PostRow[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (!ctx.settings.get('ai.imageDescriptions')) return found;
  for (const post of posts) {
    const url = post.imageUrl;
    if (!url || !isRedditImage(url)) continue;
    const cached = ctx.store.imageDescription(url);
    if (cached) {
      found.set(post.id, cached);
      continue;
    }
    if (ctx.state.imagesFailed || !aiAvailable(ctx)) continue;
    const { system, prompt } = buildImagePrompt(post.title);
    const result = await ctx.ai.text({
      task: 'image',
      system,
      prompt,
      imageUrl: url,
      maxOutputTokens: 400,
      subject: { postIds: [post.id] },
    });
    if (!result.ok) {
      ctx.state.imagesFailed = true;
      if (result.kind === 'budget') ctx.state.budgetStop ??= result.message;
      ctx.log.info('Image descriptions skipped for the rest of this scan', {
        reason: result.message,
      });
      continue;
    }
    const description = clipWords(
      result.value.replace(/\s+/g, ' ').trim(),
      CONFIG.images.maxDescriptionWords,
    );
    if (description === '') continue;
    ctx.store.saveImageDescription({
      url,
      description,
      model: result.model.model,
      createdAt: ctx.now,
    });
    found.set(post.id, description);
  }
  return found;
}
