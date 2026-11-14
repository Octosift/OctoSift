'use client';

import { Card, CardHeader } from '../../components/ui/display';
import { Checkbox, Field, Input, Select } from '../../components/ui/fields';
import { cn } from '../../components/ui/utils';
import type { SettingsData } from '../../lib/data/settings';
import { SaveBar } from './models-section';
import { SecretField } from './secret-field';
import { useSettingsForm } from './use-settings-form';

type SourceId = SettingsData['values']['source'];

const SOURCES: { id: SourceId; title: string; body: string }[] = [
  {
    id: 'session',
    title: 'Reddit account',
    body: 'Free. Reads subreddit listings with the account connected above.',
  },
  {
    id: 'provider',
    title: 'Data provider',
    body: 'Paid per request. For people who would rather not connect an account.',
  },
  {
    id: 'rss',
    title: 'Public RSS feeds',
    body: 'Free and logged out, but best effort: Reddit ended RSS support in late 2026, so these feeds may stop working at any time.',
  },
];

export function DataSourceSection({ data }: { data: SettingsData }) {
  const form = useSettingsForm(
    {
      source: data.values.source,
      provider: data.values.provider,
      price: String(data.values.providerPriceUsd),
      failover: data.values.failover,
    },
    (values) => ({
      'reddit.source': values.source,
      'reddit.provider': values.provider,
      'reddit.providerPriceUsd': Number(values.price),
      'reddit.failover': values.failover,
    }),
  );
  return (
    <Card id="data-source">
      <CardHeader
        title="Data source"
        description="How posts are read. The preferred source is tried first; the others follow if it fails."
      />
      <div className="flex flex-col gap-4 px-4 py-4 text-[13px]">
        {data.demo ? (
          <p className="text-xs text-muted-foreground">
            Demo mode reads synthetic posts whatever is chosen here.
          </p>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Preferred source</legend>
          {SOURCES.map((source) => (
            <label
              key={source.id}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2.5',
                form.values.source === source.id && 'border-brand bg-brand-subtle/40',
              )}
            >
              <input
                type="radio"
                name="data-source"
                className="mt-1 accent-[var(--brand)]"
                checked={form.values.source === source.id}
                onChange={() => {
                  form.set('source', source.id);
                }}
              />
              <span>
                <span className="font-medium">{source.title}</span>
                <span className="block text-xs text-muted-foreground">{source.body}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-3 rounded-md border border-border px-3 py-3">
          <p className="text-xs font-medium">Data provider</p>
          <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_9rem]">
            <Field label="Adapter" htmlFor="provider-adapter">
              <Select
                id="provider-adapter"
                value={form.values.provider}
                onChange={(event) => {
                  form.set('provider', event.target.value as typeof form.values.provider);
                }}
              >
                <option value="vendor">Vendor</option>
              </Select>
            </Field>
            <SecretField
              name="vendor_api_key"
              label="API key"
              description={data.secrets.vendor_api_key}
            />
            <Field
              label="Price per request (USD)"
              htmlFor="provider-price"
              error={form.errorFor('reddit.providerPriceUsd')}
            >
              <Input
                id="provider-price"
                inputMode="decimal"
                value={form.values.price}
                onChange={(event) => {
                  form.set('price', event.target.value);
                }}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            A scan reads one or two pages per subreddit and fetches full posts only for those that
            pass the free filters. Data spend counts against the same budget caps as AI and is shown
            separately on the Runs screen.
          </p>
        </div>

        <label className="flex items-start gap-2">
          <Checkbox
            className="mt-0.5"
            checked={form.values.failover}
            onChange={(event) => {
              form.set('failover', event.target.checked);
            }}
          />
          <span>
            <span className="font-medium">Fall back to the next source</span>
            <span className="block text-xs text-muted-foreground">
              When the preferred source stops working during a scan (an expired session, a blocked
              feed), the rest of the scan uses the next one in the list above that is set up.
            </span>
          </span>
        </label>
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
