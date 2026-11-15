/**
 * Recommended models per provider, grouped into three presets, with the list
 * prices used to estimate costs.
 *
 * Last checked on 2026-11-14 against the providers' own pages:
 * - Anthropic: platform.claude.com/docs/en/about-claude/models/overview and
 *   platform.claude.com/docs/en/about-claude/pricing
 * - OpenAI: developers.openai.com/api/docs/models and
 *   developers.openai.com/api/docs/pricing
 * - Codex CLI models: developers.openai.com/codex/models (now served from
 *   learn.chatgpt.com/docs/models); the same ids as the OpenAI API
 * Model ids and prices change. Check those pages again before changing this
 * file, and update the date above.
 *
 * How the presets are built:
 * - triage always uses the provider's smallest current model;
 * - Balanced uses the main mid-tier model for qualify and draft;
 * - Best quality uses the top model for qualify and draft. For Anthropic that
 *   is Claude Opus 5.5, which the docs recommend as the starting point; Claude
 *   Fable 5.2 is aimed at long-horizon agentic work and costs twice as much;
 * - review uses a different model from draft, so a second model checks the
 *   reply;
 * - Economy keeps the small model for qualify and uses a cheaper model to draft.
 *
 * The experimental Codex CLI provider uses the OpenAI presets. Its calls are
 * billed to the ChatGPT subscription; the OpenAI list prices are used to show
 * what the same tokens would cost on the API.
 */
import type { AiStage, ModelPrice, ProviderId } from './types';

export const PRESETS_CHECKED_ON = '2026-11-14';

export const PRESET_IDS = ['economy', 'balanced', 'best'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PRESET_LABELS: Record<PresetId, { label: string; hint: string }> = {
  economy: {
    label: 'Economy',
    hint: 'Lowest cost. A small model picks the leads, so it misses more of them. A mid-size model writes the replies.',
  },
  balanced: {
    label: 'Balanced',
    hint: 'A mid-size model picks the leads and writes the replies. Right for most products.',
  },
  best: {
    label: 'Best quality',
    hint: 'The top model picks the leads and writes the replies. Worth it when each customer is worth a lot.',
  },
};

/** Providers that have presets; OpenAI-compatible endpoints are configured by hand. */
export type PresetProvider = Extract<ProviderId, 'openai' | 'anthropic' | 'codex_cli'>;
export const PRESET_PROVIDERS: readonly PresetProvider[] = ['openai', 'anthropic', 'codex_cli'];

export interface CatalogModel {
  id: string;
  label: string;
  /** List price per million tokens, standard tier, short prompts. */
  price: ModelPrice & { cachedInputPerMillionUsd: number };
}

const API_CATALOG: Record<'openai' | 'anthropic', readonly CatalogModel[]> = {
  anthropic: [
    {
      id: 'claude-haiku-5-5',
      label: 'Claude Haiku 5.5',
      price: { inputPerMillionUsd: 0.1, cachedInputPerMillionUsd: 0.01, outputPerMillionUsd: 0.5 },
    },
    {
      id: 'claude-sonnet-5-5',
      label: 'Claude Sonnet 5.5',
      price: { inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.1, outputPerMillionUsd: 10 },
    },
    {
      id: 'claude-opus-5-5',
      label: 'Claude Opus 5.5',
      price: { inputPerMillionUsd: 4, cachedInputPerMillionUsd: 0.2, outputPerMillionUsd: 20 },
    },
    {
      id: 'claude-fable-5-2',
      label: 'Claude Fable 5.2',
      price: { inputPerMillionUsd: 8, cachedInputPerMillionUsd: 0.2, outputPerMillionUsd: 40 },
    },
  ],
  openai: [
    {
      id: 'gpt-6-luna',
      label: 'GPT-6 Luna',
      price: { inputPerMillionUsd: 0.1, cachedInputPerMillionUsd: 0.01, outputPerMillionUsd: 0.5 },
    },
    {
      id: 'gpt-6.1-terra',
      label: 'GPT-6.1 Terra',
      price: { inputPerMillionUsd: 1, cachedInputPerMillionUsd: 0.05, outputPerMillionUsd: 5 },
    },
    {
      id: 'gpt-6.1-sol',
      label: 'GPT-6.1 Sol',
      price: { inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.1, outputPerMillionUsd: 10 },
    },
    {
      id: 'gpt-6-astra',
      label: 'GPT-6 Astra',
      price: { inputPerMillionUsd: 10, cachedInputPerMillionUsd: 1, outputPerMillionUsd: 50 },
    },
  ],
};

const API_PRESETS: Record<'openai' | 'anthropic', Record<PresetId, Record<AiStage, string>>> = {
  anthropic: {
    economy: {
      triage: 'claude-haiku-5-5',
      qualify: 'claude-haiku-5-5',
      draft: 'claude-sonnet-5-5',
      review: 'claude-haiku-5-5',
    },
    balanced: {
      triage: 'claude-haiku-5-5',
      qualify: 'claude-sonnet-5-5',
      draft: 'claude-sonnet-5-5',
      review: 'claude-haiku-5-5',
    },
    best: {
      triage: 'claude-haiku-5-5',
      qualify: 'claude-opus-5-5',
      draft: 'claude-opus-5-5',
      review: 'claude-sonnet-5-5',
    },
  },
  openai: {
    economy: {
      triage: 'gpt-6-luna',
      qualify: 'gpt-6-luna',
      draft: 'gpt-6.1-terra',
      review: 'gpt-6-luna',
    },
    balanced: {
      triage: 'gpt-6-luna',
      qualify: 'gpt-6.1-sol',
      draft: 'gpt-6.1-sol',
      review: 'gpt-6.1-terra',
    },
    best: {
      triage: 'gpt-6-luna',
      qualify: 'gpt-6-astra',
      draft: 'gpt-6-astra',
      review: 'gpt-6.1-sol',
    },
  },
};

export const CATALOG: Record<PresetProvider, readonly CatalogModel[]> = {
  ...API_CATALOG,
  codex_cli: API_CATALOG.openai,
};

export const PRESETS: Record<PresetProvider, Record<PresetId, Record<AiStage, string>>> = {
  ...API_PRESETS,
  codex_cli: API_PRESETS.openai,
};

export const DEFAULT_PRESET: PresetId = 'balanced';

export function isPresetProvider(provider: ProviderId): provider is PresetProvider {
  return (PRESET_PROVIDERS as readonly ProviderId[]).includes(provider);
}

/** The catalogue entry for a model, when it is one of the recommended ones. */
export function catalogModel(provider: ProviderId, model: string): CatalogModel | null {
  if (!isPresetProvider(provider)) return null;
  return CATALOG[provider].find((entry) => entry.id === model) ?? null;
}

/** The four stage models a preset sets. */
export function presetStages(
  provider: PresetProvider,
  preset: PresetId,
): Record<AiStage, { provider: PresetProvider; model: string }> {
  const models = PRESETS[provider][preset];
  return {
    triage: { provider, model: models.triage },
    qualify: { provider, model: models.qualify },
    draft: { provider, model: models.draft },
    review: { provider, model: models.review },
  };
}

type StageChoice = { provider: ProviderId; model: string } | null;

/** The preset the stages match exactly, or null when they were chosen by hand. */
export function activePreset(
  stages: Record<AiStage, StageChoice>,
): { provider: PresetProvider; preset: PresetId } | null {
  for (const provider of PRESET_PROVIDERS) {
    for (const preset of PRESET_IDS) {
      const models = PRESETS[provider][preset];
      const matches = (Object.keys(models) as AiStage[]).every(
        (stage) => stages[stage]?.provider === provider && stages[stage].model === models[stage],
      );
      if (matches) return { provider, preset };
    }
  }
  return null;
}

/**
 * Whether a key can use every model of a preset. With no list (the provider
 * did not answer, or no key yet), every preset is offered.
 */
export function presetAvailable(
  provider: PresetProvider,
  preset: PresetId,
  available: readonly string[] | null,
): boolean {
  if (available === null) return true;
  const known = new Set(available);
  return Object.values(PRESETS[provider][preset]).every((model) => known.has(model));
}

/** Price-table entries for a preset's models, keyed the way the ledger looks them up. */
export function presetPrices(
  provider: PresetProvider,
  preset: PresetId,
): Record<string, CatalogModel['price']> {
  const entries = Object.values(PRESETS[provider][preset]).flatMap((model) => {
    const entry = catalogModel(provider, model);
    return entry ? [[`${provider}/${model}`, entry.price] as const] : [];
  });
  return Object.fromEntries(entries);
}

/** The recommended model for a stage, used to mark it in model lists. */
export function recommendedModel(provider: ProviderId, stage: AiStage, preset: PresetId): string {
  return isPresetProvider(provider) ? PRESETS[provider][preset][stage] : '';
}
