'use client';

import { Card, CardHeader } from '../../components/ui/display';
import { Field, Input, Select } from '../../components/ui/fields';
import type { SettingsData } from '../../lib/data/settings';
import { SaveBar } from './save-bar';
import { SecretField } from './secret-field';
import { useSettingsForm } from './use-settings-form';

export function RedditSection({ data }: { data: SettingsData }) {
  const form = useSettingsForm(
    { userAgent: data.values.userAgent, username: data.values.ownUsername ?? '' },
    (v) => ({ 'reddit.userAgent': v.userAgent, 'reddit.ownUsername': v.username.trim() || null }),
  );
  return (
    <Card id="reddit-reading">
      <CardHeader
        title="Reading Reddit"
        description="Used with either data source. The User-Agent is the name the app gives Reddit with each request."
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
            type="text"
            placeholder="user:password@proxy.example.com:8080"
            description={data.secrets.reddit_proxy_url}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Only needed if Reddit keeps pausing reads from your network. A proxy sends requests from
            a different address, and a rotating proxy uses a new one for each request.
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
        description="Optional. Posts your strongest leads to a Slack or Discord channel as they arrive, using a webhook URL you create in that app."
      />
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-[1fr_12rem]">
        <SecretField
          name="webhook_url"
          label="Webhook URL"
          type="text"
          placeholder="hooks.slack.com/services/…"
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

export function EvergreenSection({ data }: { data: SettingsData }) {
  return (
    <Card id="evergreen">
      <CardHeader
        title="Evergreen threads"
        description="Optional. Finds Reddit threads that show up on Google when your buyers search. These keep getting new readers, so they are worth answering even months later."
      />
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SecretField
            name="dataforseo_login"
            label="DataForSEO API login"
            type="text"
            placeholder="The email shown under API access"
            description={data.secrets.dataforseo_login}
          />
          <SecretField
            name="dataforseo_password"
            label="DataForSEO API password"
            description={data.secrets.dataforseo_password}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          DataForSEO is a paid service that gives the app live Google results for the United States.
          It costs about $0.004 per search phrase, so 20 phrases cost about $0.08 a check. Each
          product is checked once a week, or when you press Check now on its Evergreen tab, where
          the cost of every check is shown. Use the API password from your DataForSEO dashboard, not
          your account password.
        </p>
      </div>
    </Card>
  );
}
