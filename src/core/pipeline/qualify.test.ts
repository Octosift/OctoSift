import { describe, expect, it } from 'vitest';
import { fakeAiClient } from '../testing/fake-ai';
import { loadSampleProduct } from '../testing/sample-products';
import { qualifyPost, quoteAppearsIn, type QualifyCandidate, type QualifyContext } from './qualify';

const NOW = 1_800_000_000;

const candidate: QualifyCandidate = {
  id: 't3_q1',
  subreddit: 'freelance_demo',
  title: 'Clients keep paying late',
  bodyText:
    'I have eleven clients and three are always late.\n\nIs there a tool that sends payment reminders for me?',
  createdAt: NOW - 3 * 3600,
};

const context: QualifyContext = {
  profile: loadSampleProduct('acme-invoices'),
  rulesSummary: 'Promotion: restricted. Links: forbidden.',
  feedback: { rules: ['We do not serve agencies'], good: [], bad: [] },
  now: NOW,
};

function answer(overrides: Record<string, unknown> = {}) {
  return {
    output: {
      fit: 'direct',
      intent: 'asking_for_recommendation',
      score: 91,
      reason: 'Asks for a tool that sends payment reminders.',
      evidence_quote: 'Is there a tool that sends payment reminders for me?',
      mention_ok: true,
      dm_ok: false,
      suggested_angle: 'Explain a reminder schedule, then mention the product.',
      risk_flags: [],
      alternatives_mentioned: [],
      ...overrides,
    },
  };
}

describe('qualifyPost', () => {
  it('returns the judgement for one post sent with its full text and context', async () => {
    const { ai, generator } = fakeAiClient(() => answer());
    const outcome = await qualifyPost(ai, candidate, context);
    expect(outcome).toMatchObject({
      ok: true,
      result: { fit: 'direct', score: 91, mentionOk: true },
      internalFlags: [],
      model: 'fake-qualify',
    });
    const call = generator.calls[0];
    expect(call?.subject.postIds).toEqual(['t3_q1']);
    expect(call?.prompt).toContain('three are always late');
    expect(call?.system).toContain('Promotion: restricted.');
    expect(call?.system).toContain('We do not serve agencies');
  });

  it('accepts a quote that differs only in case, spacing or quote marks', async () => {
    const { ai } = fakeAiClient(() =>
      answer({ evidence_quote: '“is there a TOOL that  sends payment reminders for me?”' }),
    );
    const outcome = await qualifyPost(ai, candidate, context);
    expect(outcome.ok && outcome.internalFlags).toEqual([]);
  });

  it('flags a quote that does not appear in the post', async () => {
    const { ai } = fakeAiClient(() =>
      answer({ evidence_quote: 'I would pay for any invoicing app today.' }),
    );
    const outcome = await qualifyPost(ai, candidate, context);
    expect(outcome.ok && outcome.internalFlags).toEqual(['unverified_quote']);
    expect(outcome.ok && outcome.result.score).toBe(91);
  });

  it('leaves the post retryable when the call fails', async () => {
    const { ai } = fakeAiClient(() => ({ fail: 'invalid_output' }));
    expect(await qualifyPost(ai, candidate, context)).toMatchObject({
      ok: false,
      kind: 'invalid_output',
    });
  });

  it('reports a budget stop as such', async () => {
    const { ai } = fakeAiClient(() => answer(), { budgetCalls: 0 });
    expect(await qualifyPost(ai, candidate, context)).toMatchObject({ ok: false, kind: 'budget' });
  });
});

describe('quoteAppearsIn', () => {
  const text = 'First line.\n\nIs there a tool that sends payment reminders?';

  it('finds a quote across line breaks and extra spaces', () => {
    expect(quoteAppearsIn('line. is there a tool', text)).toBe(true);
  });

  it('tolerates surrounding quotes and a trailing ellipsis', () => {
    expect(quoteAppearsIn('"Is there a tool that sends..."', text)).toBe(true);
  });

  it('rejects an empty quote', () => {
    expect(quoteAppearsIn('  ', text)).toBe(false);
  });

  it('rejects a paraphrase', () => {
    expect(quoteAppearsIn('Is there an app for payment reminders?', text)).toBe(false);
  });
});
