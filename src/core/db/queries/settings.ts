/** Raw key-value access to the settings table. Callers validate the values. */
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { settings } from '../schema';

export function readSetting(
  db: Db,
  key: string,
): { found: true; value: unknown } | { found: false } {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row ? { found: true, value: row.valueJson } : { found: false };
}

export function writeSetting(db: Db, key: string, value: unknown): void {
  db.insert(settings)
    .values({ key, valueJson: value })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: value } })
    .run();
}

export function deleteSetting(db: Db, key: string): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}
