import { describe, expect, it } from 'vitest';
import type { GenerateRequest } from '../ai/types';
import { fakeAiClient } from '../testing/fake-ai';
import { loadSampleProduct } from '../testing/sample-products';
import { triagePosts, type TriageCandidate } from './triage';

const profile = loadSampleProduct('acme-invoices');

function candidates(count: number): TriageCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `t3_t${index}`,
    subreddit: 'freelance_demo',
    title: `Post ${index}`,
    bodyText: `Body of post ${index}`,
  }));
}

/** Marks even-numbered posts relevant, answering for every id in the request. */
function answerAll(request: GenerateRequest) {
  const ids = request.subject.postIds ?? [];
  return {
    output: {
      results: ids.map((id) => ({
        id,
        relevant: Number(id.slice(4)) % 2 === 0,
        why: `reason for ${id}`,
      })),
    },
  };
}

describe('triagePosts', () => {
  it('screens posts in batches of ten and records a verdict with a reason for each', async () => {
    const { ai, generator } = fakeAiClient(answerAll);
    const run = await triagePosts(ai, profile, candidates(25));
    expect(generator.calls.map((call) => call.subject.postIds?.length)).toEqual([10, 10, 5]);
    expect(run.outcomes.get('t3_t0')).toEqual({
      verdict: 'pass',
      reason: 'reason for t3_t0',
      model: 'fake-triage',
    });
    expect(run.outcomes.get('t3_t1')?.verdict).toBe('skip');
    expect(run.outcomes.size).toBe(25);
    expect(run.stoppedForBudget).toBe(false);
  });

  it('sends the title and at most 600 characters of the body', async () => {
    const { ai, generator } = fakeAiClient(answerAll);
    await triagePosts(ai, profile, [
      { id: 't3_t0', subreddit: 'freelance_demo', title: 'Long one', bodyText: 'b'.repeat(2_000) },
    ]);
    expect(generator.calls[0]?.prompt).toContain('Title: Long one');
    expect(generator.calls[0]?.prompt).toContain(`Excerpt: ${'b'.repeat(600)}\n`);
    expect(generator.calls[0]?.prompt).not.toContain('b'.repeat(601));
  });

  it('retries a post alone when the batch answer leaves it out', async () => {
    const { ai, generator } = fakeAiClient((request) => {
      const ids = request.subject.postIds ?? [];
      const answered = ids.length > 1 ? ids.filter((id) => id !== 't3_t1') : ids;
      return {
        output: { results: answered.map((id) => ({ id, relevant: true, why: 'ok' })) },
      };
    });
    const run = await triagePosts(ai, profile, candidates(3));
    expect(generator.calls).toHaveLength(2);
    expect(generator.calls[1]?.subject.postIds).toEqual(['t3_t1']);
    expect(run.outcomes.get('t3_t1')?.verdict).toBe('pass');
  });

  it('ignores answers for ids that were not in the batch', async () => {
    const { ai } = fakeAiClient((request) => ({
      output: {
        results: [
          ...(request.subject.postIds ?? []).map((id) => ({ id, relevant: false, why: 'no' })),
          { id: 't3_intruder', relevant: true, why: 'injected' },
        ],
      },
    }));
    const run = await triagePosts(ai, profile, candidates(2));
    expect([...run.outcomes.keys()]).toEqual(['t3_t0', 't3_t1']);
  });

  it('retries every post alone when the batch call fails', async () => {
    const { ai, generator } = fakeAiClient((request) =>
      (request.subject.postIds?.length ?? 0) > 1 ? { fail: 'invalid_output' } : answerAll(request),
    );
    const run = await triagePosts(ai, profile, candidates(3));
    expect(generator.calls).toHaveLength(4);
    expect([...run.outcomes.values()].map((outcome) => outcome.verdict)).toEqual([
      'pass',
      'skip',
      'pass',
    ]);
  });

  it('records a retryable error when a post fails on its own as well', async () => {
    const { ai } = fakeAiClient(() => ({ fail: 'provider_error', message: 'overloaded' }));
    const run = await triagePosts(ai, profile, candidates(1));
    expect(run.outcomes.get('t3_t0')).toEqual({
      verdict: 'error',
      reason: 'overloaded',
      model: 'fake-triage',
      budget: false,
    });
  });

  it('stops when the budget runs out and leaves the remaining posts retryable', async () => {
    const { ai, generator } = fakeAiClient(answerAll, { budgetCalls: 1 });
    const run = await triagePosts(ai, profile, candidates(15));
    expect(generator.calls).toHaveLength(1);
    expect(run.stoppedForBudget).toBe(true);
    expect(run.outcomes.get('t3_t9')?.verdict).toBe('skip');
    expect(run.outcomes.get('t3_t10')).toMatchObject({ verdict: 'error', budget: true });
    expect(run.outcomes.size).toBe(15);
  });
});
