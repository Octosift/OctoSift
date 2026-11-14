import 'server-only';
import { estimateMonthlyCost, expectedPostsPerDay } from '@/core/ai/estimate';
import { storedModelList } from '@/core/ai/model-lists';
import {
  activePreset,
  CATALOG,
  catalogModel,
  PRESET_IDS,
  PRESET_LABELS,
  PRESET_PROVIDERS,
  PRESETS,
  presetAvailable,
  presetStages,
  type PresetId,
  type PresetProvider,
} from '@/core/ai/presets';
import { enabledSubredditNames } from '@/core/db/queries/products';
import { getSubreddits } from '@/core/db/queries/subreddits';
import { AI_STAGES, type AiStage } from '@/core/settings/registry';
import { getRuntime } from '../runtime';

export interface PresetOption {
  id: PresetId;
  label: string;
  hint: string;
  models: Record<AiStage, string>;
  /** False when the saved key cannot use one of its models. */
  available: boolean;
  monthlyUsd: number | null;
  /** Billed to a subscription; monthlyUsd is then the API equivalent. */
  subscription: boolean;
}

/** What the AI settings and the onboarding AI step show. */
export function loadAiSettings() {
  const { db, settings, env } = getRuntime();
  const stages = settings.get('ai.stages');
  const prices = settings.get('ai.prices');
  const rates = getSubreddits(db, enabledSubredditNames(db)).map((row) => row.postsPerDay);
  const volume = expectedPostsPerDay(rates);
  const presets = Object.fromEntries(
    PRESET_PROVIDERS.map((provider) => {
      const available = storedModelList(db, provider);
      const options: PresetOption[] = PRESET_IDS.map((id) => ({
        id,
        ...PRESET_LABELS[id],
        models: Object.fromEntries(
          AI_STAGES.map((stage) => {
            const model = PRESETS[provider][id][stage];
            return [stage, catalogModel(provider, model)?.label ?? model];
          }),
        ) as Record<AiStage, string>,
        available: presetAvailable(provider, id, available),
        ...(() => {
          const estimate = estimateMonthlyCost(
            presetStages(provider, id),
            prices,
            volume.postsPerDay,
          );
          return { monthlyUsd: estimate.usd, subscription: estimate.subscription };
        })(),
      }));
      return [provider, options];
    }),
  ) as Record<PresetProvider, PresetOption[]>;
  return {
    /** The experimental CLI provider is offered only when the environment asks for it. */
    cliProviders: env.EXPERIMENTAL_CLI_PROVIDERS && !env.DEMO_MODE,
    codexEffort: settings.get('ai.codexEffort'),
    stages,
    active: activePreset(stages),
    presets,
    volume,
    modelLists: {
      openai: storedModelList(db, 'openai'),
      anthropic: storedModelList(db, 'anthropic'),
      openai_compatible: storedModelList(db, 'openai_compatible'),
      codex_cli: CATALOG.codex_cli.map((model) => model.id),
    },
    catalog: Object.fromEntries(
      PRESET_PROVIDERS.map((provider) => [
        provider,
        CATALOG[provider].map(({ id, label }) => ({ id, label })),
      ]),
    ) as Record<PresetProvider, { id: string; label: string }[]>,
  };
}

export type AiSettingsData = ReturnType<typeof loadAiSettings>;
