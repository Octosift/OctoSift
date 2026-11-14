import 'server-only';
import { CONFIG } from '@/core/config';
import { sessionStatus } from '@/core/reddit/account';
import type { SecretDescription, SecretName } from '@/core/secrets/store';
import { readState } from '@/core/state';
import { runsInContainer } from '../reddit-sign-in';
import { getRuntime } from '../runtime';

const SHOWN_SECRETS = [
  'openai_api_key',
  'anthropic_api_key',
  'openai_compatible_api_key',
  'reddit_proxy_url',
  'webhook_url',
  'dataforseo_login',
  'dataforseo_password',
] as const satisfies readonly SecretName[];

export type ShownSecret = (typeof SHOWN_SECRETS)[number];

export function loadSettings() {
  const { settings, secrets, env, db } = getRuntime();
  const described = Object.fromEntries(
    SHOWN_SECRETS.map((name) => [name, secrets.describe(name)]),
  ) as Record<ShownSecret, SecretDescription>;
  return {
    demo: env.DEMO_MODE,
    secrets: described,
    account: {
      ...sessionStatus(db, secrets),
      cookieMask: secrets.describe('reddit_session_cookie').mask,
      inContainer: runsInContainer(),
      profileCheck: readState(db, 'state.accountCheck'),
      perHour: CONFIG.session.maxPerHour,
    },
    values: {
      stages: settings.get('ai.stages'),
      compatibleBaseUrl: settings.get('ai.compatibleBaseUrl'),
      imageDescriptions: settings.get('ai.imageDescriptions'),
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
      source: settings.get('reddit.source'),
      failover: settings.get('reddit.failover'),
    },
  };
}

export type SettingsData = ReturnType<typeof loadSettings>;
