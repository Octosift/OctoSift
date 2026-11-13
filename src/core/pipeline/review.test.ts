import { describe, expect, it } from 'vitest';
import type { GenerateRequest } from '../ai/types';
import type { FakeReply } from '../ai/fake';
import { seededRandom } from '../clock';
import { fakeAiClient } from '../testing/fake-ai';
import { loadSampleProduct } from '../testing/sample-products';
import type { DraftRequest } from './draft';
import { writeReviewedReply } from './review';

const GOOD =
  'Send the first reminder three days before the due date, not after it. Most late payers simply ' +
  'forget, so a short friendly note with the amount and the payment link fixes half of the cases. ' +
  "I'm the maker of Acme Invoices, which sends those reminders on a schedule you choose.";

const request: DraftRequest & { rulesSummary: string | null } = {
  kind: 'reply',
  profile: loadSampleProduct('acme-invoices'),
  subreddit: 'freelance_demo',
  mode: 'soft_mention',
  linksAllowed: false,
  post: { id: 't3_r1', title: 'Clients pay late', body: 'How do I get paid on time?' },
  suggestedAngle: 'Reminder schedule',
  fixes: [],
  random: seededRandom(5),
  rulesSummary: null,
};

const draftReply = (text = GOOD): FakeReply => ({
  output: { reply: text, mentions_product: true, includes_link: false, notes_for_user: '' },
});

const verdict = (decision: string, reasons: string[] = [], fixes: string[] = []): FakeReply => ({
  output: { decision, reasons, fixes },
});

/** Answers draft calls with a good draft and review calls from a script. */
function scripted(reviews: FakeReply[]) {
  return (call: GenerateRequest): FakeReply =>
    call.task === 'review' ? (reviews.shift() ?? verdict('APPROVE')) : draftReply();
}

describe('writeReviewedReply', () => {
  it('keeps an approved draft', async () => {
    const { ai, generator } = fakeAiClient(
      scripted([verdict('APPROVE', ['Helpful and disclosed'])]),
    );
    const outcome = await writeReviewedReply(ai, request);
    expect(outcome).toMatchObject({ status: 'drafted', decision: 'APPROVE', attempts: 1 });
    expect(generator.calls.map((call) => call.task)).toEqual(['draft', 'review']);
  });

  it('regenerates with the fixes after REVISE and keeps the approved second draft', async () => {
    const { ai, generator } = fakeAiClient(
      scripted([verdict('REVISE', ['Too salesy'], ['Cut the last sentence']), verdict('APPROVE')]),
    );
    const outcome = await writeReviewedReply(ai, request);
    expect(outcome).toMatchObject({ status: 'drafted', decision: 'APPROVE', attempts: 2 });
    expect(generator.calls.map((call) => call.task)).toEqual([
      'draft',
      'review',
      'draft',
      'review',
    ]);
    expect(generator.calls[2]?.prompt).toContain('- Cut the last sentence');
  });

  it('stores no draft when the reviewer rejects it twice', async () => {
    const { ai } = fakeAiClient(
      scripted([verdict('REJECT', ['Reads like an ad']), verdict('REJECT', ['Still an ad'])]),
    );
    expect(await writeReviewedReply(ai, request)).toEqual({
      status: 'rejected',
      reasons: ['Still an ad'],
      attempts: 2,
    });
  });

  it('keeps a second draft the reviewer still wants revised, marked for editing', async () => {
    const { ai } = fakeAiClient(
      scripted([verdict('REVISE', ['Vague'], ['Be specific']), verdict('REVISE', ['Still vague'])]),
    );
    expect(await writeReviewedReply(ai, request)).toMatchObject({
      status: 'drafted',
      decision: 'REVISE',
      reasons: ['Still vague'],
    });
  });

  it('keeps the draft as not reviewed when the reviewer fails', async () => {
    const { ai } = fakeAiClient((call) =>
      call.task === 'review' ? { fail: 'provider_error', message: 'reviewer down' } : draftReply(),
    );
    expect(await writeReviewedReply(ai, request)).toMatchObject({
      status: 'drafted',
      decision: 'NOT_REVIEWED',
      reasons: ['reviewer down'],
      draft: { reply: GOOD },
    });
  });

  it('reports a draft that could not be written at all', async () => {
    const { ai } = fakeAiClient(() => ({ fail: 'provider_error', message: 'writer down' }));
    expect(await writeReviewedReply(ai, request)).toEqual({
      status: 'failed',
      kind: 'provider_error',
      message: 'writer down',
    });
  });
});
