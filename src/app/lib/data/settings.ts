import 'server-only';
import { CONFIG } from '@/core/config';
import { sessionStatus } from '@/core/reddit/account';
import type { SecretDescription, SecretName } from '@/core/secrets/store';
import { readState } from '@/core/state';
import { BRAND } from '@/core/brand';
import { lastUpdateCheck } from '@/core/updates/check';
import { runsInContainer } from '../reddit-sign-in';
import { loadAiSettings } from './ai';
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
    ai: loadAiSettings(),
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
      updatesCheck: settings.get('updates.check'),
    },
    updates: {
      version: BRAND.version,
      /** UPDATE_CHECK=0 in the environment overrides the setting. */
      envDisabled: !env.UPDATE_CHECK,
      lastCheck: lastUpdateCheck(db),
    },
  };
}

export type SettingsData = ReturnType<typeof loadSettings>;
