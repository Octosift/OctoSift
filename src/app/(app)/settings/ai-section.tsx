'use client';

import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { recommendedModel, type PresetId } from '@/core/ai/presets';
import type { AiStage, ProviderId } from '@/core/settings/registry';
import { Button } from '../../components/ui/button';
import { Badge, Card, CardHeader } from '../../components/ui/display';
import { Checkbox, Field, Input, Select } from '../../components/ui/fields';
import { cn } from '../../components/ui/utils';
import { choosePreset, refreshModelList } from '../../lib/actions/ai';
import { testStageConnection, type ConnectionResult } from '../../lib/actions/settings';
import type { PresetOption } from '../../lib/data/ai';
import type { SettingsData } from '../../lib/data/settings';
import { SaveBar } from './save-bar';
import { SecretField } from './secret-field';
import { useSettingsForm } from './use-settings-form';

type Ai = SettingsData['ai'];
export type PresetProvider = keyof Ai['presets'];

export const PROVIDER_CHOICES: Record<
  PresetProvider,
  { label: string; keyName: 'openai_api_key' | 'anthropic_api_key'; keyLabel: string }
> = {
  openai: { label: 'OpenAI', keyName: 'openai_api_key', keyLabel: 'OpenAI API key' },
  anthropic: { label: 'Anthropic', keyName: 'anthropic_api_key', keyLabel: 'Anthropic API key' },
};

const STAGES: { stage: AiStage; label: string; hint: string }[] = [
  { stage: 'triage', label: 'Triage', hint: 'Screens every post in batches.' },
  { stage: 'qualify', label: 'Qualify', hint: 'Judges each remaining post carefully.' },
  { stage: 'draft', label: 'Draft', hint: 'Writes replies for strong leads.' },
  { stage: 'review', label: 'Review', hint: 'Checks each draft; best as a different model.' },
];

const ALL_PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai_compatible', label: 'OpenAI-compatible' },
];

const CUSTOM = '__custom__';

/** "≈ $3.20 a month", rounded to whole dollars above ten. */
export function formatMonthly(usd: number | null): string {
  if (usd === null) return 'Cost unknown';
  const amount = usd >= 10 ? `$${String(Math.round(usd))}` : `$${usd.toFixed(2)}`;
  return `≈ ${amount} a month`;
}

/** The provider the stages already use, when it has presets. */
export function initialProvider(ai: Ai): PresetProvider {
  if (ai.active) return ai.active.provider;
  const used = ai.stages.qualify?.provider ?? ai.stages.triage?.provider;
  return used && used in ai.presets ? (used as PresetProvider) : 'openai';
}

export function ProviderChoice({
  value,
  onChange,
}: {
  value: PresetProvider;
  onChange: (provider: PresetProvider) => void;
}) {
  return (
    <div role="radiogroup" aria-label="AI provider" className="flex flex-wrap gap-2">
      {(Object.keys(PROVIDER_CHOICES) as PresetProvider[]).map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => {
            onChange(id);
          }}
          className={cn(
            'rounded-md border border-border px-3 py-1.5 text-[13px] font-medium',
            value === id
              ? 'border-brand bg-brand-subtle/40 text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {PROVIDER_CHOICES[id].label}
        </button>
      ))}
    </div>
  );
}

export function PresetPicker({
  options,
  value,
  onChange,
  volume,
}: {
  options: PresetOption[];
  value: PresetId;
  onChange: (preset: PresetId) => void;
  volume: Ai['volume'];
}) {
  const shown = options.filter((option) => option.available);
  if (shown.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        This key cannot use the recommended models. Choose models under Advanced in Settings.
      </p>
    );
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium">Models</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {shown.map((option) => (
          <label
            key={option.id}
            className={cn(
              'flex cursor-pointer flex-col gap-1.5 rounded-md border border-border px-3 py-2.5',
              value === option.id && 'border-brand bg-brand-subtle/40',
            )}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="ai-preset"
                className="accent-[var(--brand)]"
                checked={value === option.id}
                onChange={() => {
                  onChange(option.id);
                }}
              />
              <span className="text-[13px] font-medium">{option.label}</span>
              {option.id === 'balanced' ? <Badge tone="outline">Recommended</Badge> : null}
            </span>
            <span className="text-xs text-muted-foreground">{option.hint}</span>
            <span className="text-[13px] tabular">{formatMonthly(option.monthlyUsd)}</span>
            <span className="text-[11px] leading-relaxed text-muted-foreground">
              {STAGES.map(({ stage, label }) => (
                <span key={stage} className="block">
                  {label}: {option.models[stage]}
                </span>
              ))}
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Estimates for about {Math.round(volume.postsPerDay)} new posts a day
        {volume.measured ? ' in your subreddits' : ', typical for five subreddits'}. Each
        scan&apos;s actual cost is shown on the Runs screen.
      </p>
    </fieldset>
  );
}

/** Settings → AI: provider, key and preset, with per-stage models under Advanced. */
export function AiSection({ data }: { data: SettingsData }) {
  const router = useRouter();
  const ai = data.ai;
  const [provider, setProvider] = useState<PresetProvider>(initialProvider(ai));
  const [preset, setPreset] = useState<PresetId>(ai.active?.preset ?? 'balanced');
  const custom = ai.active === null && Object.values(ai.stages).some((stage) => stage !== null);
  const [advanced, setAdvanced] = useState(custom);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choice = PROVIDER_CHOICES[provider];

  function refresh(id: ProviderId) {
    startTransition(async () => {
      const result = await refreshModelList(id);
      setNotice(result.ok ? null : `Could not list the models: ${result.message}`);
      router.refresh();
    });
  }

  return (
    <Card id="ai">
      <CardHeader
        title="AI"
        description="Pick a provider, paste its key and choose a preset. Keys are encrypted and never shown again."
      />
      <div className="flex flex-col gap-4 px-4 py-4 text-[13px]">
        <ProviderChoice
          value={provider}
          onChange={(id) => {
            setProvider(id);
            setSaved(false);
          }}
        />
        <SecretField
          key={choice.keyName}
          name={choice.keyName}
          label={choice.keyLabel}
          description={data.secrets[choice.keyName]}
          onSaved={() => {
            refresh(provider);
          }}
          onRemoved={() => {
            router.refresh();
          }}
        />
        <PresetPicker
          options={ai.presets[provider]}
          value={preset}
          onChange={(id) => {
            setPreset(id);
            setSaved(false);
          }}
          volume={ai.volume}
        />
        {custom ? (
          <p className="text-xs text-muted-foreground">
            The stages use models chosen under Advanced. Using a preset replaces them.
          </p>
        ) : null}
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      </div>
      <SaveBar
        label="Use this preset"
        pending={pending}
        saved={saved}
        hasErrors={false}
        onSave={() => {
          startTransition(async () => {
            const result = await choosePreset({ provider, preset });
            setSaved(result.ok);
            setNotice(result.ok ? null : result.error);
            router.refresh();
          });
        }}
      />
      <div className="border-t border-border">
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => {
            setAdvanced(!advanced);
          }}
          className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-medium"
        >
          Advanced: models per stage, local models, images
          <ChevronDown
            aria-hidden
            className={cn('size-4 transition-transform', advanced && 'rotate-180')}
          />
        </button>
        {advanced ? <AdvancedModels data={data} onRefresh={refresh} /> : null}
      </div>
    </Card>
  );
}

interface StageValue {
  provider: ProviderId;
  model: string;
}

function AdvancedModels({
  data,
  onRefresh,
}: {
  data: SettingsData;
  onRefresh: (provider: ProviderId) => void;
}) {
  const ai = data.ai;
  const fallback: StageValue = { provider: initialProvider(ai), model: '' };
  const form = useSettingsForm(
    {
      triage: ai.stages.triage ?? fallback,
      qualify: ai.stages.qualify ?? fallback,
      draft: ai.stages.draft ?? fallback,
      review: ai.stages.review ?? fallback,
      baseUrl: data.values.compatibleBaseUrl ?? '',
      images: data.values.imageDescriptions,
    },
    (values) => ({
      'ai.stages': Object.fromEntries(
        STAGES.map(({ stage }) => [stage, values[stage].model.trim() ? values[stage] : null]),
      ),
      'ai.compatibleBaseUrl': values.baseUrl.trim() || null,
      'ai.imageDescriptions': values.images,
    }),
  );
  const [customStages, setCustomStages] = useState<Partial<Record<AiStage, boolean>>>({});
  const [tests, setTests] = useState<Partial<Record<AiStage, ConnectionResult | 'running'>>>({});
  const [, startTransition] = useTransition();
  const usesCompatible = STAGES.some(
    ({ stage }) => form.values[stage].provider === 'openai_compatible',
  );

  function optionsFor(provider: ProviderId, current: string): { id: string; label: string }[] {
    const listed = ai.modelLists[provider];
    const catalog = provider in ai.catalog ? ai.catalog[provider as PresetProvider] : [];
    const labels = new Map(catalog.map((entry) => [entry.id, entry.label]));
    const ids = listed ?? catalog.map((entry) => entry.id);
    const all = current && !ids.includes(current) ? [current, ...ids] : ids;
    return all.map((id) => ({ id, label: labels.get(id) ?? id }));
  }

  return (
    <div className="flex flex-col border-t border-border">
      <div className="flex flex-col divide-y divide-border">
        {STAGES.map(({ stage, label, hint }) => {
          const value = form.values[stage];
          const recommended = recommendedModel(value.provider, stage, 'balanced');
          const options = optionsFor(value.provider, value.model);
          const typing = customStages[stage] ?? false;
          const result = tests[stage];
          return (
            <div key={stage} className="flex flex-col gap-2 px-4 py-3">
              <div>
                <p className="text-[13px] font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-center">
                <Select
                  aria-label={`${label} provider`}
                  value={value.provider}
                  onChange={(event) => {
                    const provider = event.target.value as ProviderId;
                    form.set(stage, {
                      provider,
                      model: recommendedModel(provider, stage, 'balanced'),
                    });
                  }}
                >
                  {ALL_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </Select>
                {typing ? (
                  <Input
                    aria-label={`${label} custom model id`}
                    placeholder="Model id"
                    value={value.model}
                    onChange={(event) => {
                      form.set(stage, { ...value, model: event.target.value });
                    }}
                  />
                ) : (
                  <Select
                    aria-label={`${label} model`}
                    value={value.model}
                    onChange={(event) => {
                      if (event.target.value === CUSTOM) {
                        setCustomStages({ ...customStages, [stage]: true });
                        return;
                      }
                      form.set(stage, { ...value, model: event.target.value });
                    }}
                  >
                    {value.model === '' ? <option value="">Choose a model</option> : null}
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.id === recommended ? ' (recommended)' : ''}
                      </option>
                    ))}
                    <option value={CUSTOM}>Custom model id…</option>
                  </Select>
                )}
                <Button
                  size="sm"
                  onClick={() => {
                    setTests({ ...tests, [stage]: 'running' });
                    startTransition(async () => {
                      const outcome = await testStageConnection(stage);
                      setTests((current) => ({ ...current, [stage]: outcome }));
                    });
                  }}
                  disabled={result === 'running'}
                >
                  {result === 'running' ? 'Testing…' : 'Test'}
                </Button>
              </div>
              {result && result !== 'running' ? (
                <p
                  role="status"
                  className={`text-xs ${result.ok ? 'text-brand-subtle-foreground' : 'text-danger-foreground'}`}
                >
                  {result.ok
                    ? `Connected to ${result.model} in ${String(result.latencyMs)} ms.`
                    : `Connection failed: ${result.message}`}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        Model lists come from each provider for the saved key.
        {(['openai', 'anthropic', 'openai_compatible'] as const).map((provider) => (
          <Button
            key={provider}
            size="sm"
            variant="ghost"
            onClick={() => {
              onRefresh(provider);
            }}
          >
            Reload {ALL_PROVIDERS.find((entry) => entry.id === provider)?.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-2">
        <Field
          label="OpenAI-compatible base URL"
          htmlFor="compatible-base-url"
          hint="For Ollama, LM Studio, OpenRouter and similar, for example http://localhost:11434/v1"
          error={form.errorFor('ai.compatibleBaseUrl')}
        >
          <Input
            id="compatible-base-url"
            type="url"
            value={form.values.baseUrl}
            onChange={(event) => {
              form.set('baseUrl', event.target.value);
            }}
          />
        </Field>
        <SecretField
          name="openai_compatible_api_key"
          label="OpenAI-compatible key (if needed)"
          description={data.secrets.openai_compatible_api_key}
        />
        {usesCompatible && form.values.baseUrl.trim() === '' ? (
          <p className="text-xs text-danger-foreground sm:col-span-2">
            A stage uses the OpenAI-compatible endpoint; set its base URL.
          </p>
        ) : null}
      </div>
      <div className="border-t border-border px-4 py-3">
        <label className="flex items-start gap-2 text-[13px]">
          <Checkbox
            className="mt-0.5"
            checked={form.values.images}
            onChange={(event) => {
              form.set('images', event.target.checked);
            }}
          />
          <span>
            <span className="font-medium">Describe images in posts</span>
            <span className="block text-xs text-muted-foreground">
              The Qualify model describes each image hosted on Reddit once, in up to 150 words. Use
              it only if that model accepts images; it adds one call per new image.
            </span>
          </span>
        </label>
      </div>
      {form.errorFor('ai.stages') ? (
        <p role="alert" className="px-4 pb-2 text-xs text-danger-foreground">
          {form.errorFor('ai.stages')}
        </p>
      ) : null}
      <SaveBar
        label="Save these models"
        pending={form.pending}
        saved={form.saved}
        hasErrors={form.hasErrors}
        onSave={form.save}
      />
    </div>
  );
}
