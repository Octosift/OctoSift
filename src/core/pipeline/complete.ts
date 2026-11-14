/**
 * Sources that list posts with a preview only (a paid data provider) are
 * completed here: after the free filters, the survivors' full posts are
 * fetched in batches and stored, so the AI stages read the whole text. When
 * that fails the scan carries on with the previews.
 */
import type { PostRow } from '../db/queries/posts';
import type { EvaluateContext } from './evaluate-context';

export async function completePosts(ctx: EvaluateContext, posts: PostRow[]): Promise<PostRow[]> {
  const partial = posts.filter((post) => post.partial);
  if (partial.length === 0 || !ctx.fetchDetails) return posts;
  const result = await ctx.fetchDetails(partial.map((post) => post.id));
  if (!result.ok) {
    if (result.kind === 'budget') ctx.state.budgetStop ??= result.message;
    ctx.log.warn('Could not fetch full posts; using previews', { reason: result.message });
    return posts;
  }
  const full = new Map(result.posts.map((post) => [post.id, post]));
  return posts.map((post) => {
    const detail = full.get(post.id);
    if (!detail) return post;
    const completed: PostRow = {
      ...post,
      author: detail.author === '[deleted]' ? post.author : detail.author,
      bodyText: detail.bodyText || post.bodyText,
      bodyLinksJson: detail.bodyLinks,
      imageUrl: detail.imageUrl ?? post.imageUrl,
      createdAt: detail.createdAt,
      score: detail.score ?? null,
      commentCount: detail.commentCount ?? null,
      nsfw: detail.nsfw ?? false,
      locked: detail.locked ?? false,
      removed: detail.removed ?? false,
      partial: false,
    };
    ctx.store.completePost(completed);
    return completed;
  });
}
