/** Reads and writes for the AI cost ledger. */
import { and, gte, isNotNull, sum } from 'drizzle-orm';
import type { Db } from '../client';
import { usage } from '../schema';

export type UsageRow = typeof usage.$inferInsert;

export function insertUsage(db: Db, row: UsageRow): void {
  db.insert(usage).values(row).run();
}

/** Total known cost of AI calls since the given time (epoch seconds). */
export function costSince(db: Db, sinceS: number): number {
  const row = db
    .select({ total: sum(usage.costUsd) })
    .from(usage)
    .where(and(gte(usage.createdAt, sinceS), isNotNull(usage.costUsd)))
    .get();
  return Number(row?.total ?? 0);
}
