/** The founder's verdicts on leads, which shape the qualify prompt. */
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import type { FeedbackContext, FeedbackExample } from '../../ai/prompts/qualify';
import { CONFIG } from '../../config';
import { newId } from '../../ids';
import type { Db } from '../client';
import { feedback, leads, posts } from '../schema';

export function insertFeedback(
  db: Db,
  input: {
    productId: string;
    leadId: string | null;
    signal: 'good' | 'bad';
    note: string;
    now: number;
  },
): void {
  db.insert(feedback)
    .values({
      id: newId(),
      productId: input.productId,
      leadId: input.leadId,
      signal: input.signal,
      note: input.note,
      createdAt: input.now,
    })
    .run();
}

export interface FeedbackRule {
  id: string;
  note: string;
  signal: 'good' | 'bad';
  createdAt: number;
  leadTitle: string | null;
}

/** The most recent notes, newest first, without repeats. These become the rules. */
export function feedbackRules(db: Db, productId: string): FeedbackRule[] {
  const rows = db
    .select({
      id: feedback.id,
      note: feedback.note,
      signal: feedback.signal,
      createdAt: feedback.createdAt,
      leadTitle: posts.title,
    })
    .from(feedback)
    .leftJoin(leads, eq(leads.id, feedback.leadId))
    .leftJoin(posts, eq(posts.id, leads.postId))
    .where(and(eq(feedback.productId, productId), ne(feedback.note, '')))
    .orderBy(desc(feedback.createdAt), desc(feedback.id))
    .all();
  const seen = new Set<string>();
  const rules: FeedbackRule[] = [];
  for (const row of rows) {
    const key = row.note.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(row);
    if (rules.length === CONFIG.feedback.maxRules) break;
  }
  return rules;
}

function examples(
  db: Db,
  productId: string,
  signal: 'good' | 'bad',
  limit: number,
): FeedbackExample[] {
  return db
    .select({ title: posts.title, reason: leads.reason })
    .from(feedback)
    .innerJoin(leads, eq(leads.id, feedback.leadId))
    .innerJoin(posts, eq(posts.id, leads.postId))
    .where(
      and(
        eq(feedback.productId, productId),
        eq(feedback.signal, signal),
        isNotNull(feedback.leadId),
      ),
    )
    .orderBy(desc(feedback.createdAt), desc(feedback.id))
    .limit(limit)
    .all();
}

/** Everything the qualify prompt learns from the founder's past verdicts. */
export function feedbackContext(db: Db, productId: string): FeedbackContext {
  return {
    rules: feedbackRules(db, productId).map((rule) => rule.note),
    good: examples(db, productId, 'good', CONFIG.feedback.goodExamples),
    bad: examples(db, productId, 'bad', CONFIG.feedback.badExamples),
  };
}

export function updateFeedbackNote(db: Db, id: string, note: string): void {
  db.update(feedback).set({ note }).where(eq(feedback.id, id)).run();
}
