/** Reads for the inbox: lead lists by tab and filter, counts, and one lead in full. */
import { and, count, desc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client';
import { drafts, feedback, leads, posts, products, replyChecks, type LeadStatus } from '../schema';

/** "todo" holds every opportunity that still needs action: new and drafted. */
export const INBOX_TABS = ['todo', 'replied', 'snoozed', 'dismissed', 'brand'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export interface InboxFilters {
  tab: InboxTab;
  productId?: string | undefined;
  subreddit?: string | undefined;
  intent?: string | undefined;
  minScore?: number | undefined;
  /** Only posts created within this many hours. */
  maxAgeHours?: number | undefined;
}

export interface InboxRow {
  id: string;
  productId: string;
  productName: string;
  kind: string;
  score: number;
  intent: string;
  reason: string;
  status: LeadStatus;
  title: string;
  subreddit: string;
  postCreatedAt: number;
  createdAt: number;
}

function tabCondition(tab: InboxTab): SQL | undefined {
  switch (tab) {
    case 'todo':
      return and(eq(leads.kind, 'opportunity'), inArray(leads.status, ['new', 'drafted']));
    case 'brand':
      return and(eq(leads.kind, 'brand_mention'), inArray(leads.status, ['new', 'drafted']));
    default:
      return eq(leads.status, tab);
  }
}

function conditions(filters: Omit<InboxFilters, 'tab'>, now: number): SQL[] {
  const list: SQL[] = [];
  if (filters.productId) list.push(eq(leads.productId, filters.productId));
  if (filters.subreddit) list.push(eq(posts.subreddit, filters.subreddit));
  if (filters.intent) list.push(eq(leads.intent, filters.intent));
  if (filters.minScore !== undefined) list.push(gte(leads.score, filters.minScore));
  if (filters.maxAgeHours !== undefined) {
    list.push(gte(posts.createdAt, now - filters.maxAgeHours * 3600));
  }
  return list;
}

export function listLeads(
  db: Db,
  filters: InboxFilters,
  page: { limit: number; offset: number; now: number },
): { rows: InboxRow[]; total: number } {
  const where = and(tabCondition(filters.tab), ...conditions(filters, page.now));
  const order =
    filters.tab === 'brand' || filters.tab === 'replied' || filters.tab === 'dismissed'
      ? [desc(leads.updatedAt)]
      : [desc(leads.score), desc(posts.createdAt)];
  const rows = db
    .select({
      id: leads.id,
      productId: leads.productId,
      productName: products.name,
      kind: leads.kind,
      score: leads.score,
      intent: leads.intent,
      reason: leads.reason,
      status: leads.status,
      title: posts.title,
      subreddit: posts.subreddit,
      postCreatedAt: posts.createdAt,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(posts, eq(posts.id, leads.postId))
    .innerJoin(products, eq(products.id, leads.productId))
    .where(where)
    .orderBy(...order, desc(leads.id))
    .limit(page.limit)
    .offset(page.offset)
    .all();
  const total =
    db
      .select({ value: count() })
      .from(leads)
      .innerJoin(posts, eq(posts.id, leads.postId))
      .where(where)
      .get()?.value ?? 0;
  return { rows, total };
}

export function countByTab(db: Db, productId?: string): Record<InboxTab, number> {
  const productFilter = productId ? eq(leads.productId, productId) : undefined;
  const counts = Object.fromEntries(INBOX_TABS.map((tab) => [tab, 0])) as Record<InboxTab, number>;
  for (const tab of INBOX_TABS) {
    counts[tab] =
      db
        .select({ value: count() })
        .from(leads)
        .where(and(tabCondition(tab), productFilter))
        .get()?.value ?? 0;
  }
  return counts;
}

/** Returns snoozed leads whose time has come to the New tab. */
export function wakeSnoozedLeads(db: Db, now: number): number {
  return db
    .update(leads)
    .set({ status: 'new', snoozedUntil: null, updatedAt: now })
    .where(and(eq(leads.status, 'snoozed'), lte(leads.snoozedUntil, now)))
    .run().changes;
}

export function inboxSubreddits(db: Db, productId?: string): string[] {
  return db
    .selectDistinct({ subreddit: posts.subreddit })
    .from(leads)
    .innerJoin(posts, eq(posts.id, leads.postId))
    .where(productId ? eq(leads.productId, productId) : ne(leads.id, ''))
    .orderBy(posts.subreddit)
    .all()
    .map((row) => row.subreddit);
}

export function leadDetail(db: Db, id: string) {
  const row = db
    .select({ lead: leads, post: posts, productName: products.name, productMode: products.mode })
    .from(leads)
    .innerJoin(posts, eq(posts.id, leads.postId))
    .innerJoin(products, eq(products.id, leads.productId))
    .where(eq(leads.id, id))
    .get();
  if (!row) return null;
  const latest = (kind: 'reply' | 'dm') =>
    db
      .select()
      .from(drafts)
      .where(and(eq(drafts.leadId, id), eq(drafts.kind, kind)))
      .orderBy(desc(drafts.version))
      .limit(1)
      .get() ?? null;
  const verdict = db
    .select({ signal: feedback.signal, note: feedback.note })
    .from(feedback)
    .where(eq(feedback.leadId, id))
    .orderBy(desc(feedback.createdAt))
    .limit(1)
    .get();
  return {
    ...row,
    reply: latest('reply'),
    dm: latest('dm'),
    feedback: verdict ?? null,
    replyChecks: db
      .select({
        kind: replyChecks.kind,
        dueAt: replyChecks.dueAt,
        result: replyChecks.result,
        checkedAt: replyChecks.checkedAt,
      })
      .from(replyChecks)
      .where(eq(replyChecks.leadId, id))
      .orderBy(replyChecks.dueAt)
      .all(),
    draftCount:
      db
        .select({ value: sql<number>`count(*)` })
        .from(drafts)
        .where(eq(drafts.leadId, id))
        .get()?.value ?? 0,
  };
}

export type LeadDetail = NonNullable<ReturnType<typeof leadDetail>>;
