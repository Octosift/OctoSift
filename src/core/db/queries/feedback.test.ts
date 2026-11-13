import { beforeEach, describe, expect, it } from 'vitest';
import { runScan } from '../../pipeline/run';
import { createScanHarness, type ScanHarness } from '../../testing/scan-harness';
import { leads } from '../schema';
import { feedbackContext, feedbackRules, insertFeedback, updateFeedbackNote } from './feedback';

let harness: ScanHarness;
let leadIds: string[];

beforeEach(async () => {
  harness = createScanHarness('acme-invoices');
  await runScan(harness.deps, { trigger: 'cli' });
  leadIds = harness.db
    .select({ id: leads.id })
    .from(leads)
    .all()
    .map((row) => row.id);
});

function give(index: number, signal: 'good' | 'bad', note: string, at: number) {
  insertFeedback(harness.db, {
    productId: harness.productId,
    leadId: leadIds[index] ?? null,
    signal,
    note,
    now: at,
  });
}

describe('feedback rules', () => {
  it('turns notes into rules, newest first, without repeats or empty notes', () => {
    give(0, 'bad', 'We do not serve agencies', 1);
    give(1, 'good', '', 2);
    give(2, 'bad', 'we do not serve agencies', 3);
    give(3, 'bad', 'Skip tax questions', 4);
    expect(feedbackRules(harness.db, harness.productId).map((rule) => rule.note)).toEqual([
      'Skip tax questions',
      'we do not serve agencies',
    ]);
  });

  it('keeps at most twenty rules', () => {
    for (let index = 0; index < 25; index += 1) give(0, 'bad', `Rule ${index}`, index);
    const rules = feedbackRules(harness.db, harness.productId);
    expect(rules).toHaveLength(20);
    expect(rules[0]?.note).toBe('Rule 24');
  });

  it('lets a rule be edited or removed by changing its note', () => {
    give(0, 'bad', 'Too broad', 1);
    const [rule] = feedbackRules(harness.db, harness.productId);
    updateFeedbackNote(harness.db, rule?.id ?? '', 'Narrower rule');
    expect(feedbackRules(harness.db, harness.productId).map((r) => r.note)).toEqual([
      'Narrower rule',
    ]);
    updateFeedbackNote(harness.db, rule?.id ?? '', '');
    expect(feedbackRules(harness.db, harness.productId)).toEqual([]);
  });
});

describe('feedbackContext', () => {
  it('includes the five most recent good and bad leads as examples', () => {
    for (let index = 0; index < 7; index += 1) give(index, 'good', '', index);
    give(8, 'bad', 'Not for us', 10);
    const context = feedbackContext(harness.db, harness.productId);
    expect(context.good).toHaveLength(5);
    expect(context.bad).toHaveLength(1);
    expect(context.bad[0]).toEqual({
      title: expect.any(String) as string,
      reason: expect.any(String) as string,
    });
    expect(context.rules).toEqual(['Not for us']);
  });
});
