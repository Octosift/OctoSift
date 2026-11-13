'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { listModels, testConnection } from '@/core/ai/provider';
import {
  AI_STAGES,
  isSettingKey,
  PROVIDER_IDS,
  SETTINGS,
  type ProviderId,
} from '@/core/settings/registry';
import { deleteAllData } from '@/core/db/queries/data';
import { isSecretName, maskSecret, type SecretName } from '@/core/secrets/store';
import type { SettingInput, SettingKey } from '@/core/settings/registry';
import { getRuntime } from '../runtime';

/** Secrets the dashboard may set; others belong to integrations that are not enabled yet. */
const EDITABLE_SECRETS: readonly SecretName[] = [
  'openai_api_key',
  'anthropic_api_key',
  'google_api_key',
  'openai_compatible_api_key',
  'reddit_proxy_url',
  'webhook_url',
];

export type SecretResult = { ok: true; mask: string } | { ok: false; error: string };

const secretInput = z.object({
  name: z.string().refine(isSecretName),
  value: z.string().trim().min(1, 'Enter a value').max(4_000),
});

/** Stores a secret encrypted. Only its mask ever comes back. */
export async function saveSecret(input: { name: string; value: string }): Promise<SecretResult> {
  const parsed = secretInput.safeParse(input);
  if (!parsed.success || !EDITABLE_SECRETS.includes(parsed.data.name)) {
    return {
      ok: false,
      error: parsed.success
        ? 'This value cannot be set here.'
        : (parsed.error.issues[0]?.message ?? 'Invalid value'),
    };
  }
  const name = parsed.data.name;
  if (
    (name === 'webhook_url' || name === 'reddit_proxy_url') &&
    !z.url().safeParse(parsed.data.value).success
  ) {
    return { ok: false, error: 'Enter a full URL, including https:// or http://' };
  }
  getRuntime().secrets.set(name, parsed.data.value);
  revalidatePath('/settings');
  return Promise.resolve({ ok: true, mask: maskSecret(parsed.data.value) });
}

export async function removeSecret(input: { name: string }): Promise<{ ok: boolean }> {
  if (!isSecretName(input.name) || !EDITABLE_SECRETS.includes(input.name)) return { ok: false };
  getRuntime().secrets.remove(input.name);
  revalidatePath('/settings');
  return Promise.resolve({ ok: true });
}

export type SettingsResult = { ok: true } | { ok: false; errors: Record<string, string[]> };

/** Saves several settings at once; nothing is saved unless every value is valid. */
export async function saveSettings(changes: Record<string, unknown>): Promise<SettingsResult> {
  const { settings } = getRuntime();
  const errors: Record<string, string[]> = {};
  const keys = Object.keys(changes);
  for (const key of keys) {
    if (!isSettingKey(key) || key === 'onboarding.completed') errors[key] = ['Unknown setting'];
  }
  if (Object.keys(errors).length > 0) return Promise.resolve({ ok: false, errors });
  // Validate everything first so a partly invalid form changes nothing.
  for (const key of keys as SettingKey[]) {
    const parsed = SETTINGS[key].schema.safeParse(changes[key]);
    if (!parsed.success) errors[key] = parsed.error.issues.map((issue) => issue.message);
  }
  if (Object.keys(errors).length > 0) return Promise.resolve({ ok: false, errors });
  for (const key of keys as SettingKey[]) {
    settings.set(key, changes[key] as SettingInput<typeof key>);
  }
  revalidatePath('/', 'layout');
  return Promise.resolve({ ok: true });
}

export type ConnectionResult =
  { ok: true; model: string; latencyMs: number } | { ok: false; message: string };

export async function testStageConnection(stage: string): Promise<ConnectionResult> {
  const parsed = z.enum(AI_STAGES).safeParse(stage);
  if (!parsed.success) return { ok: false, message: 'Unknown stage' };
  const runtime = getRuntime();
  const resolution = runtime.resolveModel(parsed.data);
  if (!resolution.ok) return { ok: false, message: resolution.message };
  const result = await testConnection(
    runtime.generator,
    resolution.model,
    resolution.credentials,
    () => runtime.clock.nowMs(),
  );
  return result.ok ? result : { ok: false, message: runtime.redactor.redact(result.message) };
}

const SECRET_FOR: Record<ProviderId, SecretName> = {
  openai: 'openai_api_key',
  anthropic: 'anthropic_api_key',
  google: 'google_api_key',
  openai_compatible: 'openai_compatible_api_key',
};

export async function loadModelSuggestions(
  provider: string,
): Promise<{ ok: true; models: string[] } | { ok: false; message: string }> {
  const parsed = z.enum(PROVIDER_IDS).safeParse(provider);
  if (!parsed.success) return { ok: false, message: 'Unknown provider' };
  const runtime = getRuntime();
  if (runtime.env.DEMO_MODE) {
    return { ok: true, models: AI_STAGES.map((stage) => `demo-${stage}`) };
  }
  const key = runtime.secrets.use(SECRET_FOR[parsed.data]);
  if (!key.ok && parsed.data !== 'openai_compatible') {
    return { ok: false, message: 'Save an API key for this provider first.' };
  }
  const result = await listModels(parsed.data, {
    apiKey: key.ok ? key.value : '',
    baseUrl: runtime.settings.get('ai.compatibleBaseUrl'),
  });
  return result.ok ? result : { ok: false, message: runtime.redactor.redact(result.message) };
}

export async function deleteEverything(
  confirmation: string,
): Promise<{ ok: false; error: string }> {
  if (confirmation.trim().toLowerCase() !== 'delete') {
    return Promise.resolve({ ok: false, error: 'Type delete to confirm.' });
  }
  deleteAllData(getRuntime().db);
  revalidatePath('/', 'layout');
  redirect('/onboarding');
}
