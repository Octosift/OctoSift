/** The founder's verdicts on leads, which later shape the qualify prompt. */
import { newId } from '../../ids';
import type { Db } from '../client';
import { feedback } from '../schema';

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
