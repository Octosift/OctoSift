import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { createSettingsStore } from '../settings/store';
import { applyPreset } from './apply-preset';
import { estimateMonthlyCost, expectedPostsPerDay, DEFAULT_POSTS_PER_DAY } from './estimate';
import {
  activePreset,
  CATALOG,
  catalogModel,
  PRESET_IDS,
  PRESET_PROVIDERS,
  PRESETS,
  presetAvailable,
  presetPrices,
  presetStages,
} from './presets';

describe('presets', () => {
  it.each(PRESET_PROVIDERS)('use only catalogued %s models, following the rules', (provider) => {
    const cheapest = [...CATALOG[provider]].sort(
      (a, b) => a.price.inputPerMillionUsd - b.price.inputPerMillionUsd,
    )[0]?.id;
    for (const preset of PRESET_IDS) {
      const models = PRESETS[provider][preset];
      for (const model of Object.values(models)) {
        expect(catalogModel(provider, model)).not.toBeNull();
      }
      expect(models.triage).toBe(cheapest);
      expect(models.review).not.toBe(models.draft);
    }
  });

  it('cost more from Economy to Best quality', () => {
    for (const provider of PRESET_PROVIDERS) {
      const cost = (preset: (typeof PRESET_IDS)[number]) =>
        estimateMonthlyCost(presetStages(provider, preset), {}, 960).usd ?? 0;
      expect(cost('economy')).toBeLessThan(cost('balanced'));
      expect(cost('balanced')).toBeLessThan(cost('best'));
    }
  });

  it('are recognised from the stage models, and hand-picked models are not', () => {
    const stages = presetStages('anthropic', 'best');
    expect(activePreset(stages)).toEqual({ provider: 'anthropic', preset: 'best' });
    expect(
      activePreset({ ...stages, review: { provider: 'anthropic', model: 'claude-opus-5-5' } }),
    ).toBeNull();
    expect(activePreset({ triage: null, qualify: null, draft: null, review: null })).toBeNull();
  });

  it('are offered only when the key can use every model', () => {
    const balanced = Object.values(PRESETS.openai.balanced);
    expect(presetAvailable('openai', 'balanced', null)).toBe(true);
    expect(presetAvailable('openai', 'balanced', [...balanced, 'other-model'])).toBe(true);
    expect(presetAvailable('openai', 'best', balanced)).toBe(false);
  });

  it('give price-table entries keyed by provider and model', () => {
    expect(presetPrices('anthropic', 'balanced')).toEqual({
      'anthropic/claude-haiku-5-5': {
        inputPerMillionUsd: 0.1,
        cachedInputPerMillionUsd: 0.01,
        outputPerMillionUsd: 0.5,
      },
      'anthropic/claude-sonnet-5-5': {
        inputPerMillionUsd: 2,
        cachedInputPerMillionUsd: 0.1,
        outputPerMillionUsd: 10,
      },
    });
  });
});

describe('monthly estimate', () => {
  const small = { provider: 'openai_compatible' as const, model: 'small-model' };
  const strong = { provider: 'openai_compatible' as const, model: 'strong-model' };
  const prices = {
    'small-model': { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
    'strong-model': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  };

  it('matches the illustrative scan in the README, about $80 a month for 40 posts an hour', () => {
    const estimate = estimateMonthlyCost(
      { triage: small, qualify: strong, draft: strong, review: small },
      prices,
      960,
    );
    expect(estimate.usd).toBeCloseTo(76.3, 0);
    expect(estimate.unpriced).toEqual([]);
  });

  it('prefers the user price table over the catalogue, and says which stages have no price', () => {
    const haiku = { provider: 'anthropic' as const, model: 'claude-haiku-5-5' };
    const cheap = estimateMonthlyCost(
      { triage: haiku, qualify: haiku, draft: haiku, review: haiku },
      {},
      960,
    );
    const pricier = estimateMonthlyCost(
      { triage: haiku, qualify: haiku, draft: haiku, review: haiku },
      { 'anthropic/claude-haiku-5-5': { inputPerMillionUsd: 1, outputPerMillionUsd: 5 } },
      960,
    );
    expect(pricier.usd ?? 0).toBeCloseTo((cheap.usd ?? 0) * 10, 6);
    expect(
      estimateMonthlyCost({ triage: small, qualify: null, draft: strong, review: small }, {}, 960),
    ).toMatchObject({ usd: null, unpriced: ['triage', 'qualify', 'draft', 'review'] });
  });

  it('takes the volume from the subreddits when their rates are known', () => {
    expect(expectedPostsPerDay([12, null, 30])).toEqual({ postsPerDay: 42, measured: true });
    expect(expectedPostsPerDay([null])).toEqual({
      postsPerDay: DEFAULT_POSTS_PER_DAY,
      measured: false,
    });
  });
});

describe('applying a preset', () => {
  it('sets the stages and adds missing prices without touching the user ones', () => {
    const settings = createSettingsStore(openMemoryDatabase());
    settings.set('ai.prices', {
      'openai/gpt-6.1-sol': { inputPerMillionUsd: 1.5, outputPerMillionUsd: 9 },
    });
    applyPreset(settings, 'openai', 'balanced');
    expect(settings.get('ai.stages')).toEqual(presetStages('openai', 'balanced'));
    const prices = settings.get('ai.prices');
    expect(prices['openai/gpt-6.1-sol']).toEqual({
      inputPerMillionUsd: 1.5,
      outputPerMillionUsd: 9,
    });
    expect(prices['openai/gpt-6-luna']?.inputPerMillionUsd).toBe(0.1);
    expect(Object.keys(prices).sort()).toEqual([
      'openai/gpt-6-luna',
      'openai/gpt-6.1-sol',
      'openai/gpt-6.1-terra',
    ]);
  });
});
