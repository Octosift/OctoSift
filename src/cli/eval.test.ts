import { describe, expect, it } from 'vitest';
import { createFixtureResponder } from '../core/ai/fake-responder';
import { createFakeGenerator } from '../core/ai/fake';
import { openMemoryDatabase } from '../core/db/client';
import { usage } from '../core/db/schema';
import { loadSampleProducts, SAMPLE_PRODUCT_SLUGS } from '../core/demo/sample-products';
import { loadGoldenSet } from '../core/eval/golden';
import { silentLogger } from '../core/log';
import { createSettingsStore } from '../core/settings/store';
import { createFakeClock } from '../core/testing/fake-clock';
import { parseEvalArgs, runEvalCommand, type EvalDeps } from './eval';

function deps(): EvalDeps {
  const db = openMemoryDatabase();
  const settings = createSettingsStore(db);
  settings.set('ai.prices', { 'eval-model': { inputPerMillionUsd: 1, outputPerMillionUsd: 1 } });
  const labels = new Map(
    SAMPLE_PRODUCT_SLUGS.flatMap((slug) =>
      loadGoldenSet(slug).posts.map((post) => [post.id, post.label] as const),
    ),
  );
  return {
    db,
    generator: createFakeGenerator(
      createFixtureResponder({ labels, profiles: Object.values(loadSampleProducts()) }),
    ),
    resolveModel: () => ({
      ok: true,
      model: { provider: 'openai_compatible', model: 'eval-model' },
      credentials: { apiKey: '', baseUrl: 'http://localhost:0' },
    }),
    settings,
    clock: createFakeClock(),
    log: silentLogger(),
    redact: (text) => text,
  };
}

describe('parseEvalArgs', () => {
  it('defaults to a one dollar cap over all sample products', () => {
    expect(parseEvalArgs(['--yes-spend'])).toEqual({
      ok: true,
      options: { yesSpend: true, maxCost: 1, products: [...SAMPLE_PRODUCT_SLUGS], json: false },
    });
  });

  it('rejects a non-positive cap and unknown products', () => {
    expect(parseEvalArgs(['--max-cost', '0']).ok).toBe(false);
    expect(parseEvalArgs(['--product', 'other']).ok).toBe(false);
  });
});

describe('runEvalCommand', () => {
  it('explains what it would spend and stops without --yes-spend', async () => {
    const environment = deps();
    const result = await runEvalCommand(environment, {
      yesSpend: false,
      maxCost: 1,
      products: ['acme-plants'],
      json: false,
    });
    expect(result.code).toBe(2);
    expect(result.output).toContain('24 golden posts');
    expect(result.output).toContain('--yes-spend');
    expect(environment.db.select().from(usage).all()).toEqual([]);
  });

  it('prints precision, recall, the confusion table, cost and misses', async () => {
    const result = await runEvalCommand(deps(), {
      yesSpend: true,
      maxCost: 1,
      products: ['acme-logs'],
      json: false,
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain('Leads   precision 100.0% (16/16)  recall 100.0% (16/16)');
    expect(result.output).toContain('Confusion by fit');
    expect(result.output).toMatch(/Cost: \$0\.\d{4}, per post: \$0\.\d{5}/);
    expect(result.output).toContain('No misses.');
  });
});
