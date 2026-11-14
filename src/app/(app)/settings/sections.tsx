'use client';

import { Card, CardHeader } from '../../components/ui/display';
import { Field, Input, Textarea } from '../../components/ui/fields';
import type { SettingsData } from '../../lib/data/settings';
import { SaveBar } from './save-bar';
import { useSettingsForm } from './use-settings-form';

const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));
const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export function BudgetSection({ data }: { data: SettingsData }) {
  const { values } = data;
  const form = useSettingsForm(
    {
      perRun: String(values.perRunUsd),
      perDay: String(values.perDayUsd),
      interval: String(values.intervalMinutes),
      show: String(values.thresholds.show),
      draft: String(values.thresholds.draft),
      notify: String(values.thresholds.notify),
    },
    (v) => ({
      'budget.perRunUsd': toNumber(v.perRun),
      'budget.perDayUsd': toNumber(v.perDay),
      'schedule.intervalMinutes': toNumber(v.interval),
      thresholds: { show: toNumber(v.show), draft: toNumber(v.draft), notify: toNumber(v.notify) },
    }),
  );
  const number = (
    key: keyof typeof form.values,
    label: string,
    setting: string,
    hint: string,
    step = '1',
  ) => (
    <Field label={label} htmlFor={`setting-${key}`} hint={hint} error={form.errorFor(setting)}>
      <Input
        id={`setting-${key}`}
        type="number"
        inputMode="decimal"
        step={step}
        min="0"
        value={form.values[key]}
        onChange={(event) => {
          form.set(key, event.target.value);
        }}
      />
    </Field>
  );
  return (
    <Card id="budget">
      <CardHeader title="Budget, schedule and thresholds" />
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-3">
        {number(
          'perRun',
          'Budget per scan (USD)',
          'budget.perRunUsd',
          'A scan stops cleanly here.',
          '0.05',
        )}
        {number(
          'perDay',
          'Budget per 24 hours (USD)',
          'budget.perDayUsd',
          'Across all scans.',
          '0.5',
        )}
        {number('interval', 'Scan every (minutes)', 'schedule.intervalMinutes', 'At least 15.')}
        {number('show', 'Show in inbox from score', 'thresholds', 'Default 60.')}
        {number('draft', 'Draft replies from score', 'thresholds', 'Default 75.')}
        {number('notify', 'Notify from score', 'thresholds', 'Default 85.')}
      </div>
      <SaveBar
        pending={form.pending}
        saved={form.saved}
        hasErrors={form.hasErrors}
        onSave={form.save}
      />
    </Card>
  );
}

export function PricesSection({ data }: { data: SettingsData }) {
  const initial = Object.entries(data.values.prices)
    .map(([model, price]) =>
      [
        model,
        price.inputPerMillionUsd,
        price.outputPerMillionUsd,
        ...(price.cachedInputPerMillionUsd === undefined ? [] : [price.cachedInputPerMillionUsd]),
      ].join(' '),
    )
    .join('\n');
  const form = useSettingsForm({ text: initial }, (v) => ({
    'ai.prices': Object.fromEntries(
      lines(v.text).map((line) => {
        const [model = '', input = '', output = '', cached] = line.split(/\s+/);
        return [
          model,
          {
            inputPerMillionUsd: toNumber(input),
            outputPerMillionUsd: toNumber(output),
            ...(cached === undefined ? {} : { cachedInputPerMillionUsd: toNumber(cached) }),
          },
        ];
      }),
    ),
  }));
  return (
    <Card id="prices">
      <CardHeader
        title="Model prices"
        description="Used to show the cost of each scan and enforce the budget. Choosing a preset fills in its models; models without a price are counted as unknown."
      />
      <div className="px-4 py-4">
        <Field
          label="One model per line: model id, input and output price in USD per million tokens, and optionally the cached-input price"
          htmlFor="prices"
          hint="For example: openai/gpt-6-luna 0.10 0.50 0.01. Use provider/model to price one provider's model separately."
          error={form.errorFor('ai.prices')}
        >
          <Textarea
            id="prices"
            className="font-mono text-xs"
            rows={5}
            value={form.values.text}
            onChange={(event) => {
              form.set('text', event.target.value);
            }}
          />
        </Field>
      </div>
      <SaveBar
        pending={form.pending}
        saved={form.saved}
        hasErrors={form.hasErrors}
        onSave={form.save}
      />
    </Card>
  );
}

export function FiltersSection({ data }: { data: SettingsData }) {
  const { values } = data;
  const form = useSettingsForm(
    {
      maxAge: String(values.maxPostAgeHours),
      languages: values.languages.join(', '),
      subreddits: values.blocklist.subreddits.join('\n'),
      terms: values.blocklist.terms.join('\n'),
    },
    (v) => ({
      'prefilter.maxPostAgeHours': toNumber(v.maxAge),
      'prefilter.languages': v.languages
        .split(',')
        .map((code) => code.trim())
        .filter((code) => code.length > 0),
      blocklist: { subreddits: lines(v.subreddits), terms: lines(v.terms) },
    }),
  );
  return (
    <Card id="filters">
      <CardHeader title="Filters" description="Applied before any AI call, so they cost nothing." />
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <Field
          label="Maximum post age (hours)"
          htmlFor="max-age"
          error={form.errorFor('prefilter.maxPostAgeHours')}
        >
          <Input
            id="max-age"
            type="number"
            min="1"
            value={form.values.maxAge}
            onChange={(event) => {
              form.set('maxAge', event.target.value);
            }}
          />
        </Field>
        <Field
          label="Languages"
          htmlFor="languages"
          hint="Two-letter codes, separated by commas, for example en, de."
          error={form.errorFor('prefilter.languages')}
        >
          <Input
            id="languages"
            value={form.values.languages}
            onChange={(event) => {
              form.set('languages', event.target.value);
            }}
          />
        </Field>
        <Field
          label="Never read these subreddits"
          htmlFor="blocked-subreddits"
          hint="One per line."
          error={form.errorFor('blocklist')}
        >
          <Textarea
            id="blocked-subreddits"
            rows={3}
            value={form.values.subreddits}
            onChange={(event) => {
              form.set('subreddits', event.target.value);
            }}
          />
        </Field>
        <Field
          label="Skip posts containing"
          htmlFor="blocked-terms"
          hint="One word or phrase per line."
        >
          <Textarea
            id="blocked-terms"
            rows={3}
            value={form.values.terms}
            onChange={(event) => {
              form.set('terms', event.target.value);
            }}
          />
        </Field>
      </div>
      <SaveBar
        pending={form.pending}
        saved={form.saved}
        hasErrors={form.hasErrors}
        onSave={form.save}
      />
    </Card>
  );
}
