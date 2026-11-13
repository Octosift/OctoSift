import { describe, expect, it } from 'vitest';
import { createFixtureResponder } from '../ai/fake-responder';
import type { GenerateRequest } from '../ai/types';
import { loadSampleProducts, SAMPLE_PRODUCT_SLUGS } from '../demo/sample-products';
import { fakeAiClient } from '../testing/fake-ai';
import { createFakeClock } from '../testing/fake-clock';
import { loadGoldenSet } from './golden';
import { confusionByFit, worstMisses } from './metrics';
import { evaluablePosts, runEvaluation } from './run-eval';

const labels = new Map(
  SAMPLE_PRODUCT_SLUGS.flatMap((slug) =>
    loadGoldenSet(slug).posts.map((post) => [post.id, post.label] as const),
  ),
);
const responder = createFixtureResponder({ labels, profiles: Object.values(loadSampleProducts()) });

function evaluate(respond = responder, budgetCalls?: number) {
  const { ai, generator } = fakeAiClient(respond, budgetCalls === undefined ? {} : { budgetCalls });
  return {
    generator,
    report: runEvaluation({
      ai,
      products: [...SAMPLE_PRODUCT_SLUGS],
      clock: createFakeClock(),
      showThreshold: 60,
      spend: () => ({ costUsd: generator.calls.length * 0.001, incomplete: false }),
    }),
  };
}

describe('runEvaluation', () => {
  it('only evaluates posts that would reach the AI stages', () => {
    expect(evaluablePosts('acme-invoices')).toHaveLength(24);
  });

  it('scores a model that answers like the labels as perfect', async () => {
    const report = await evaluate().report;
    expect(report.cases).toHaveLength(72);
    expect(report.leads.precision.value).toBe(1);
    expect(report.leads.recall.value).toBe(1);
    expect(report.triage.recall.value).toBe(1);
    expect(report.worst).toEqual([]);
    expect(report.confusion.direct.direct).toBe(30);
    expect(report.costPerPost).toBeGreaterThan(0);
  });

  it('lists the worst misses of a model that rates everything low', async () => {
    const pessimist = (request: GenerateRequest) => {
      const reply = responder(request);
      if (request.task !== 'qualify' || 'fail' in reply) return reply;
      return { output: { ...(reply.output as object), score: 20 } };
    };
    const report = await evaluate(pessimist).report;
    expect(report.leads.recall.value).toBe(0);
    expect(report.worst).toHaveLength(10);
    expect(report.worst[0]?.label.expect).toBe('lead');
  });

  it('stops at the budget and says so', async () => {
    const report = await evaluate(responder, 2).report;
    expect(report.stoppedForBudget).toBe(true);
    expect(report.cases.length).toBeLessThan(72);
  });
});

describe('metrics', () => {
  it('counts posts that were never qualified in their own column', () => {
    const golden = evaluablePosts('acme-logs')[0];
    if (!golden) throw new Error('fixture missing');
    const table = confusionByFit([
      {
        product: 'acme-logs',
        id: golden.id,
        title: golden.title,
        label: golden.label,
        triageRelevant: false,
        fit: null,
        score: null,
        reason: 'screened out',
        predictedLead: false,
        expectedLead: true,
      },
    ]);
    expect(table.direct.not_qualified).toBe(1);
    expect(worstMisses([])).toEqual([]);
  });
});
