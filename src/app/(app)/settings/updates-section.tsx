'use client';

import { Card, CardHeader } from '../../components/ui/display';
import { Checkbox } from '../../components/ui/fields';
import { formatAgo } from '../../lib/format';
import type { SettingsData } from '../../lib/data/settings';
import { SaveBar } from './save-bar';
import { useSettingsForm } from './use-settings-form';

function lastCheckLine(updates: SettingsData['updates'], now: number): string {
  const last = updates.lastCheck;
  if (!last) return 'Not checked yet. The background worker checks soon after it starts.';
  const when = formatAgo(Math.floor(last.checkedAt / 1000), now);
  if (last.error) return `Last check ${when} did not reach GitHub: ${last.error}.`;
  if (!last.latest) return `Checked ${when}. No release has been published yet.`;
  return last.latest.version === updates.version
    ? `Checked ${when}. You have the latest version.`
    : `Checked ${when}. The latest release is ${last.latest.version}.`;
}

export function UpdatesSection({ data, now }: { data: SettingsData; now: number }) {
  const { updates } = data;
  const form = useSettingsForm({ check: data.values.updatesCheck }, (values) => ({
    'updates.check': values.check,
  }));
  return (
    <Card id="updates">
      <CardHeader title="Updates" description={`You are running Octosift ${updates.version}.`} />
      <div className="flex flex-col gap-3 px-4 py-4 text-sm">
        <label className="flex items-start gap-2">
          <Checkbox
            className="mt-0.5"
            checked={form.values.check}
            disabled={updates.envDisabled || data.demo}
            onChange={(event) => {
              form.set('check', event.target.checked);
            }}
          />
          <span>
            <span className="font-medium">Tell me when a new version is out</span>
            <span className="block text-xs text-muted-foreground">
              Once a day the app asks GitHub for the latest release and shows it on Home, with any
              announcement from its release notes. The request carries only the app&apos;s name and
              version; nothing about you, your products or your leads is sent.
            </span>
          </span>
        </label>
        {updates.envDisabled ? (
          <p className="text-xs text-muted-foreground">
            Turned off with UPDATE_CHECK in the environment.
          </p>
        ) : data.demo ? (
          <p className="text-xs text-muted-foreground">Demo mode never checks for updates.</p>
        ) : form.values.check ? (
          <p className="text-xs text-muted-foreground">{lastCheckLine(updates, now)}</p>
        ) : null}
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
