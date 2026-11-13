'use client';

import { Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '../../components/ui/button';
import { Banner, Card, CardHeader } from '../../components/ui/display';
import { Field, Input, Select, Textarea } from '../../components/ui/fields';
import { deleteEverything } from '../../lib/actions/settings';
import type { SettingsData } from '../../lib/data/settings';
import { SaveBar } from './models-section';
import { SecretField } from './secret-field';
import { useSettingsForm } from './use-settings-form';

const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));
const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export function KeysSection({ data }: { data: SettingsData }) {
  return (
    <Card id="ai">
      <CardHeader
        title="AI provider keys"
        description="Keys are encrypted before they are stored and are never shown again. Environment variables take precedence."
      />
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <SecretField
          name="openai_api_key"
          label="OpenAI API key"
          description={data.secrets.openai_api_key}
        />
        <SecretField
          name="anthropic_api_key"
          label="Anthropic API key"
          description={data.secrets.anthropic_api_key}
        />
        <SecretField
          name="google_api_key"
          label="Google AI API key"
          description={data.secrets.google_api_key}
        />
        <SecretField
          name="openai_compatible_api_key"
          label="OpenAI-compatible key (if needed)"
          description={data.secrets.openai_compatible_api_key}
        />
      </div>
    </Card>
  );
}

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
    .map(([model, price]) => `${model} ${price.inputPerMillionUsd} ${price.outputPerMillionUsd}`)
    .join('\n');
  const form = useSettingsForm({ text: initial }, (v) => ({
    'ai.prices': Object.fromEntries(
      lines(v.text).map((line) => {
        const [model = '', input = '', output = ''] = line.split(/\s+/);
        return [
          model,
          { inputPerMillionUsd: toNumber(input), outputPerMillionUsd: toNumber(output) },
        ];
      }),
    ),
  }));
  return (
    <Card id="prices">
      <CardHeader
        title="Model prices"
        description="Used to show the cost of each scan and enforce the budget. Models without a price are counted as unknown."
      />
      <div className="px-4 py-4">
        <Field
          label="One model per line: model id, input and output price in USD per million tokens"
          htmlFor="prices"
          hint="For example: small-model 0.15 0.60. Use provider/model to price one provider's model separately."
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

export function RedditSection({ data }: { data: SettingsData }) {
  const form = useSettingsForm(
    { userAgent: data.values.userAgent, username: data.values.ownUsername ?? '' },
    (v) => ({ 'reddit.userAgent': v.userAgent, 'reddit.ownUsername': v.username.trim() || null }),
  );
  return (
    <Card id="reddit">
      <CardHeader
        title="Reddit"
        description="Posts are read from public feeds without logging in, about one request a minute."
      />
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <Field
          label="Your Reddit username"
          htmlFor="reddit-username"
          hint="Only used to skip your own posts."
          error={form.errorFor('reddit.ownUsername')}
        >
          <Input
            id="reddit-username"
            placeholder="without u/"
            value={form.values.username}
            onChange={(event) => {
              form.set('username', event.target.value);
            }}
          />
        </Field>
        <Field label="User-Agent" htmlFor="user-agent" error={form.errorFor('reddit.userAgent')}>
          <Input
            id="user-agent"
            value={form.values.userAgent}
            onChange={(event) => {
              form.set('userAgent', event.target.value);
            }}
          />
        </Field>
        <div className="sm:col-span-2">
          <SecretField
            name="reddit_proxy_url"
            label="Proxy URL (optional)"
            type="url"
            placeholder="http://user:password@proxy.example.com:8080"
            description={data.secrets.reddit_proxy_url}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            If Reddit keeps pausing reads from your network, a proxy gives requests another exit
            address. Each request opens a fresh connection so a rotating proxy can change it.
          </p>
        </div>
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

export function NotificationsSection({ data }: { data: SettingsData }) {
  const form = useSettingsForm({ format: data.values.notifyFormat }, (v) => ({
    'notify.format': v.format,
  }));
  return (
    <Card id="notifications">
      <CardHeader
        title="Notifications"
        description="Optional. Strong leads (from the notify score) are posted to a webhook."
      />
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-[1fr_12rem]">
        <SecretField
          name="webhook_url"
          label="Webhook URL"
          type="url"
          placeholder="https://hooks.example.com/…"
          description={data.secrets.webhook_url}
        />
        <Field label="Format" htmlFor="webhook-format">
          <Select
            id="webhook-format"
            value={form.values.format}
            onChange={(event) => {
              form.set('format', event.target.value as 'slack' | 'discord');
            }}
          >
            <option value="slack">Slack-style</option>
            <option value="discord">Discord-style</option>
          </Select>
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

export function DataSection() {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Card id="data">
      <CardHeader
        title="Your data"
        description="Everything is stored in a SQLite file on this machine."
      />
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px]">
            Download products, posts, leads, drafts, runs and settings as JSON. Keys are not
            included.
          </p>
          <Button asChild>
            <a href="/api/export" download>
              Export JSON
            </a>
          </Button>
        </div>
        <Banner tone="danger" className="flex-col gap-2">
          <p className="font-medium">Delete all data</p>
          <p>
            Removes every product, post, lead, draft, run, setting and saved key. This cannot be
            undone. Type <strong>delete</strong> to confirm.
          </p>
          <form
            className="flex w-full flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const result = await deleteEverything(confirm);
                setError(result.error);
              });
            }}
          >
            <Input
              aria-label="Type delete to confirm"
              className="max-w-40"
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
              }}
            />
            <Button type="submit" variant="danger" disabled={pending}>
              <Trash2 aria-hidden /> Delete everything
            </Button>
          </form>
          {error ? <p role="alert">{error}</p> : null}
        </Banner>
      </div>
    </Card>
  );
}
