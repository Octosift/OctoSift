/** Stored Reddit posts. Each post is stored once, whichever product found it. */
import { and, eq, gte, inArray } from 'drizzle-orm';
import type { HashedPost } from '../../pipeline/dedup';
import type { Db } from '../client';
import { posts } from '../schema';

export type PostRow = typeof posts.$inferSelect;

export function knownPostIds(db: Db, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  return new Set(
    db
      .select({ id: posts.id })
      .from(posts)
      .where(inArray(posts.id, ids))
      .all()
      .map((row) => row.id),
  );
}

export function insertPosts(db: Db, rows: (typeof posts.$inferInsert)[]): void {
  if (rows.length === 0) return;
  db.insert(posts).values(rows).onConflictDoNothing().run();
}

export function postsWithHashes(db: Db, hashes: string[]): HashedPost[] {
  if (hashes.length === 0) return [];
  return db
    .select({
      id: posts.id,
      subreddit: posts.subreddit,
      createdAt: posts.createdAt,
      contentHash: posts.contentHash,
    })
    .from(posts)
    .where(inArray(posts.contentHash, hashes))
    .all();
}

export function getPost(db: Db, id: string): PostRow | null {
  return db.select().from(posts).where(eq(posts.id, id)).get() ?? null;
}

export function getPosts(db: Db, ids: string[]): PostRow[] {
  if (ids.length === 0) return [];
  return db.select().from(posts).where(inArray(posts.id, ids)).all();
}

/** Posts from the given subreddits created at or after `since`. */
export function recentPosts(db: Db, subredditNames: string[], since: number): PostRow[] {
  if (subredditNames.length === 0) return [];
  return db
    .select()
    .from(posts)
    .where(and(inArray(posts.subreddit, subredditNames), gte(posts.createdAt, since)))
    .all();
}
