/** Leads: posts that passed qualification, and their drafts. */
import { and, desc, eq, max } from 'drizzle-orm';
import type { Db } from '../client';
import { drafts, leads, type DraftKind, type LeadStatus } from '../schema';

export type LeadRow = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type DraftRow = typeof drafts.$inferSelect;

/** Inserts a lead unless the product already has one for this post. Returns whether it was new. */
export function insertLead(db: Db, lead: NewLead): boolean {
  const result = db.insert(leads).values(lead).onConflictDoNothing().run();
  return result.changes > 0;
}

export function getLead(db: Db, id: string): LeadRow | null {
  return db.select().from(leads).where(eq(leads.id, id)).get() ?? null;
}

export function leadForPost(db: Db, productId: string, postId: string): LeadRow | null {
  return (
    db
      .select()
      .from(leads)
      .where(and(eq(leads.productId, productId), eq(leads.postId, postId)))
      .get() ?? null
  );
}

export function updateLead(
  db: Db,
  id: string,
  changes: Partial<
    Pick<
      LeadRow,
      | 'status'
      | 'snoozedUntil'
      | 'dismissReason'
      | 'repliedAt'
      | 'repliedWithMention'
      | 'commentUrl'
      | 'draftError'
      | 'notifiedAt'
    >
  >,
  now: number,
): void {
  db.update(leads)
    .set({ ...changes, updatedAt: now })
    .where(eq(leads.id, id))
    .run();
}

export function setLeadStatus(db: Db, id: string, status: LeadStatus, now: number): void {
  updateLead(db, id, { status }, now);
}

/** Stores a new version of a draft for the lead. */
export function insertDraft(db: Db, draft: Omit<typeof drafts.$inferInsert, 'version'>): number {
  const row = db
    .select({ version: max(drafts.version) })
    .from(drafts)
    .where(and(eq(drafts.leadId, draft.leadId), eq(drafts.kind, draft.kind)))
    .get();
  const version = (row?.version ?? 0) + 1;
  db.insert(drafts)
    .values({ ...draft, version })
    .run();
  return version;
}

export function latestDraft(db: Db, leadId: string, kind: DraftKind): DraftRow | null {
  return (
    db
      .select()
      .from(drafts)
      .where(and(eq(drafts.leadId, leadId), eq(drafts.kind, kind)))
      .orderBy(desc(drafts.version))
      .limit(1)
      .get() ?? null
  );
}

export function updateDraftText(db: Db, id: string, text: string): void {
  db.update(drafts).set({ text, editedByUser: true }).where(eq(drafts.id, id)).run();
}
