'use client';

import { Card, CardHeader } from '../../components/ui/display';
import { Field, Input, Select } from '../../components/ui/fields';
import type { SettingsData } from '../../lib/data/settings';
import { SaveBar } from './models-section';
import { SecretField } from './secret-field';
import { useSettingsForm } from './use-settings-form';

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
