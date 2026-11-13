/** Products and the subreddits each product watches. */
import { and, asc, eq } from 'drizzle-orm';
import { productProfileSchema, type ProductProfile } from '../../profile/types';
import type { Db } from '../client';
import { products, productSubreddits, subreddits, type ReplyMode } from '../schema';

export interface Product {
  id: string;
  name: string;
  url: string;
  mode: ReplyMode;
  /** Null when the stored profile no longer matches the schema. */
  profile: ProductProfile | null;
  createdAt: number;
  updatedAt: number;
}

function toProduct(row: typeof products.$inferSelect): Product {
  const parsed = productProfileSchema.safeParse(row.profileJson);
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    mode: row.mode,
    profile: parsed.success ? parsed.data : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function insertProduct(
  db: Db,
  input: { id: string; profile: ProductProfile; mode?: ReplyMode; now: number },
): void {
  db.insert(products)
    .values({
      id: input.id,
      name: input.profile.name,
      url: input.profile.url,
      profileJson: input.profile,
      mode: input.mode ?? 'direct',
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();
}

export function updateProduct(
  db: Db,
  id: string,
  changes: { profile?: ProductProfile; mode?: ReplyMode },
  now: number,
): void {
  db.update(products)
    .set({
      ...(changes.profile
        ? { profileJson: changes.profile, name: changes.profile.name, url: changes.profile.url }
        : {}),
      ...(changes.mode ? { mode: changes.mode } : {}),
      updatedAt: now,
    })
    .where(eq(products.id, id))
    .run();
}

export function getProduct(db: Db, id: string): Product | null {
  const row = db.select().from(products).where(eq(products.id, id)).get();
  return row ? toProduct(row) : null;
}

export function listProducts(db: Db): Product[] {
  return db.select().from(products).orderBy(asc(products.createdAt)).all().map(toProduct);
}

export function deleteProduct(db: Db, id: string): void {
  db.delete(products).where(eq(products.id, id)).run();
}

/** Adds a subreddit to the shared list (if new) and links it to the product. */
export function watchSubreddit(db: Db, productId: string, name: string, now: number): void {
  db.insert(subreddits).values({ name, createdAt: now }).onConflictDoNothing().run();
  db.insert(productSubreddits)
    .values({ productId, subreddit: name, enabled: true, addedAt: now })
    .onConflictDoUpdate({
      target: [productSubreddits.productId, productSubreddits.subreddit],
      set: { enabled: true },
    })
    .run();
}

export function unwatchSubreddit(db: Db, productId: string, name: string): void {
  db.delete(productSubreddits)
    .where(and(eq(productSubreddits.productId, productId), eq(productSubreddits.subreddit, name)))
    .run();
}

export function setSubredditEnabled(
  db: Db,
  productId: string,
  name: string,
  enabled: boolean,
): void {
  db.update(productSubreddits)
    .set({ enabled })
    .where(and(eq(productSubreddits.productId, productId), eq(productSubreddits.subreddit, name)))
    .run();
}

export function watchedSubreddits(
  db: Db,
  productId: string,
): { subreddit: string; enabled: boolean }[] {
  return db
    .select({ subreddit: productSubreddits.subreddit, enabled: productSubreddits.enabled })
    .from(productSubreddits)
    .where(eq(productSubreddits.productId, productId))
    .orderBy(asc(productSubreddits.subreddit))
    .all();
}

/** Every subreddit at least one product reads, without duplicates. */
export function enabledSubredditNames(db: Db): string[] {
  return db
    .selectDistinct({ subreddit: productSubreddits.subreddit })
    .from(productSubreddits)
    .where(eq(productSubreddits.enabled, true))
    .orderBy(asc(productSubreddits.subreddit))
    .all()
    .map((row) => row.subreddit);
}
