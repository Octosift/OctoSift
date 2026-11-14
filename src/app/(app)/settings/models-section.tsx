'use client';

import { useState, useTransition } from 'react';
import type { AiStage, ProviderId } from '@/core/settings/registry';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/display';
import { Checkbox, Field, Input, Select } from '../../components/ui/fields';
import {
  loadModelSuggestions,
  testStageConnection,
  type ConnectionResult,
} from '../../lib/actions/settings';
import type { SettingsData } from '../../lib/data/settings';
import { useSettingsForm } from './use-settings-form';

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google' },
  { id: 'openai_compatible', label: 'OpenAI-compatible' },
];

const STAGES: { stage: AiStage; label: string; hint: string }[] = [
  {
    stage: 'triage',
    label: 'Triage',
    hint: 'Screens every post in batches. A small, cheap model is enough.',
  },
  {
    stage: 'qualify',
    label: 'Qualify',
    hint: 'Judges each remaining post carefully. Use a strong model.',
  },
  { stage: 'draft', label: 'Draft', hint: 'Writes replies for strong leads.' },
  {
    stage: 'review',
    label: 'Review',
    hint: 'Checks each draft. A different model than Draft works best.',
  },
];

type StageValues = Record<AiStage, { provider: ProviderId; model: string }>;

export function SaveBar({
  pending,
  saved,
  hasErrors,
  onSave,
  label = 'Save',
}: {
  pending: boolean;
  saved: boolean;
  hasErrors: boolean;
  onSave: () => void;
  label?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
      <span role="status" className="text-xs text-muted-foreground">
        {hasErrors ? 'Fix the highlighted fields.' : saved ? 'Saved.' : ''}
      </span>
      <Button variant="primary" onClick={onSave} disabled={pending}>
        {pending ? 'Saving…' : label}
      </Button>
    </div>
  );
}

export function ModelsSection({ data }: { data: SettingsData }) {
  const initial: StageValues = {
    triage: data.values.stages.triage ?? { provider: 'openai', model: '' },
    qualify: data.values.stages.qualify ?? { provider: 'openai', model: '' },
    draft: data.values.stages.draft ?? { provider: 'openai', model: '' },
    review: data.values.stages.review ?? { provider: 'openai', model: '' },
  };
  const form = useSettingsForm(
    {
      ...initial,
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
  const [suggestions, setSuggestions] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [tests, setTests] = useState<Partial<Record<AiStage, ConnectionResult | 'running'>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const usesCompatible = STAGES.some(
    ({ stage }) => form.values[stage].provider === 'openai_compatible',
  );

  function loadSuggestions(provider: ProviderId) {
    startTransition(async () => {
      const result = await loadModelSuggestions(provider);
      if (result.ok) setSuggestions((current) => ({ ...current, [provider]: result.models }));
      setNotice(result.ok ? null : result.message);
    });
  }

  function test(stage: AiStage) {
    setTests((current) => ({ ...current, [stage]: 'running' }));
    startTransition(async () => {
      const result = await testStageConnection(stage);
      setTests((current) => ({ ...current, [stage]: result }));
    });
  }

  return (
    <Card id="models">
      <CardHeader
        title="Models"
        description="Pick one model per stage. Any model id your provider accepts works; save before testing."
      />
      <div className="flex flex-col divide-y divide-border">
        {STAGES.map(({ stage, label, hint }) => {
          const value = form.values[stage];
          const result = tests[stage];
          return (
            <div key={stage} className="flex flex-col gap-2 px-4 py-3">
              <div>
                <p className="text-[13px] font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[13rem_minmax(0,1fr)_auto] sm:items-center">
                <Select
                  aria-label={`${label} provider`}
                  value={value.provider}
                  onChange={(event) => {
                    form.set(stage, { ...value, provider: event.target.value as ProviderId });
                  }}
                >
                  {PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </Select>
                <div className="flex gap-2">
                  <Input
                    aria-label={`${label} model`}
                    list={`models-${value.provider}`}
                    placeholder="Model id"
                    value={value.model}
                    onChange={(event) => {
                      form.set(stage, { ...value, model: event.target.value });
                    }}
                    onFocus={() => {
                      if (!suggestions[value.provider]) loadSuggestions(value.provider);
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      test(stage);
                    }}
                    disabled={result === 'running'}
                  >
                    {result === 'running' ? 'Testing…' : 'Test connection'}
                  </Button>
                </div>
              </div>
              {result && result !== 'running' ? (
                <p
                  role="status"
                  className={`text-xs ${result.ok ? 'text-brand-subtle-foreground' : 'text-danger-foreground'}`}
                >
                  {result.ok
                    ? `Connected to ${result.model} in ${result.latencyMs} ms.`
                    : `Connection failed: ${result.message}`}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {PROVIDERS.map((provider) => (
        <datalist key={provider.id} id={`models-${provider.id}`}>
          {(suggestions[provider.id] ?? []).map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      ))}
      {usesCompatible ? (
        <div className="border-t border-border px-4 py-3">
          <Field
            label="OpenAI-compatible base URL"
            htmlFor="compatible-base-url"
            hint="For OpenRouter, Ollama, LM Studio and similar, for example http://localhost:11434/v1"
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
        </div>
      ) : null}
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
              The Qualify model describes each image hosted on Reddit once, in up to 150 words, and
              the description is read with the post. Use it only if that model accepts images; it
              adds one call per new image.
            </span>
          </span>
        </label>
      </div>
      {notice ? <p className="px-4 pb-2 text-xs text-muted-foreground">{notice}</p> : null}
      {form.errorFor('ai.stages') ? (
        <p role="alert" className="px-4 pb-2 text-xs text-danger-foreground">
          {form.errorFor('ai.stages')}
        </p>
      ) : null}
      <SaveBar
        pending={form.pending}
        saved={form.saved}
        hasErrors={form.hasErrors}
        onSave={form.save}
      />
    </Card>
  );
}
