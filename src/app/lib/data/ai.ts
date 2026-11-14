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
}

/** What the AI settings and the onboarding AI step show. */
export function loadAiSettings() {
  const { db, settings } = getRuntime();
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
        monthlyUsd: estimateMonthlyCost(presetStages(provider, id), prices, volume.postsPerDay).usd,
      }));
      return [provider, options];
    }),
  ) as Record<PresetProvider, PresetOption[]>;
  return {
    stages,
    active: activePreset(stages),
    presets,
    volume,
    modelLists: {
      openai: storedModelList(db, 'openai'),
      anthropic: storedModelList(db, 'anthropic'),
      openai_compatible: storedModelList(db, 'openai_compatible'),
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
