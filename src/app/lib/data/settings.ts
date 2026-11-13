import 'server-only';
import type { SecretDescription, SecretName } from '@/core/secrets/store';
import { getRuntime } from '../runtime';

const SHOWN_SECRETS = [
  'openai_api_key',
  'anthropic_api_key',
  'google_api_key',
  'openai_compatible_api_key',
  'reddit_proxy_url',
  'webhook_url',
] as const satisfies readonly SecretName[];

export type ShownSecret = (typeof SHOWN_SECRETS)[number];

export function loadSettings() {
  const { settings, secrets, env } = getRuntime();
  const described = Object.fromEntries(
    SHOWN_SECRETS.map((name) => [name, secrets.describe(name)]),
  ) as Record<ShownSecret, SecretDescription>;
  return {
    demo: env.DEMO_MODE,
    secrets: described,
    values: {
      stages: settings.get('ai.stages'),
      compatibleBaseUrl: settings.get('ai.compatibleBaseUrl'),
      prices: settings.get('ai.prices'),
      perRunUsd: settings.get('budget.perRunUsd'),
      perDayUsd: settings.get('budget.perDayUsd'),
      intervalMinutes: settings.get('schedule.intervalMinutes'),
      thresholds: settings.get('thresholds'),
      maxPostAgeHours: settings.get('prefilter.maxPostAgeHours'),
      languages: settings.get('prefilter.languages'),
      blocklist: settings.get('blocklist'),
      userAgent: settings.get('reddit.userAgent'),
      ownUsername: settings.get('reddit.ownUsername'),
      notifyFormat: settings.get('notify.format'),
    },
  };
}

export type SettingsData = ReturnType<typeof loadSettings>;
