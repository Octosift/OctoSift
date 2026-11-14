/** The cache of image descriptions, keyed by image address. */
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { imageDescriptions } from '../schema';

export type ImageDescriptionRow = typeof imageDescriptions.$inferSelect;

export function getImageDescription(db: Db, url: string): ImageDescriptionRow | null {
  return db.select().from(imageDescriptions).where(eq(imageDescriptions.url, url)).get() ?? null;
}

export function saveImageDescription(db: Db, row: ImageDescriptionRow): void {
  db.insert(imageDescriptions).values(row).onConflictDoNothing().run();
}
