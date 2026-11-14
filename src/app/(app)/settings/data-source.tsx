'use client';

import { Card, CardHeader } from '../../components/ui/display';
import { Checkbox } from '../../components/ui/fields';
import { cn } from '../../components/ui/utils';
import type { SettingsData } from '../../lib/data/settings';
import { SaveBar } from './save-bar';
import { useSettingsForm } from './use-settings-form';

type SourceId = SettingsData['values']['source'];

const SOURCES: { id: SourceId; title: string; body: string }[] = [
  {
    id: 'session',
    title: 'Reddit account',
    body: 'Reads subreddit listings with the account connected above.',
  },
  {
    id: 'rss',
    title: 'Public RSS feeds',
    body: 'Free and logged out, but best effort: Reddit ended RSS support in late 2026, so these feeds may stop working at any time.',
  },
];

export function DataSourceSection({ data }: { data: SettingsData }) {
  const form = useSettingsForm(
    { source: data.values.source, failover: data.values.failover },
    (values) => ({ 'reddit.source': values.source, 'reddit.failover': values.failover }),
  );
  return (
    <Card id="data-source">
      <CardHeader
        title="Data source"
        description="How posts are read. The preferred source is tried first; the other follows if it fails."
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

        <label className="flex items-start gap-2">
          <Checkbox
            className="mt-0.5"
            checked={form.values.failover}
            onChange={(event) => {
              form.set('failover', event.target.checked);
            }}
          />
          <span>
            <span className="font-medium">Fall back to the other source</span>
            <span className="block text-xs text-muted-foreground">
              When the preferred source stops working during a scan (an expired session, a blocked
              feed), the rest of the scan uses the other one, if it is set up.
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
