'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { forgetModelList } from '@/core/ai/model-lists';
import { normalizeWebUrl } from '@/core/urls';
import { testConnection } from '@/core/ai/provider';
import { AI_STAGES, isSettingKey, SETTINGS, type ProviderId } from '@/core/settings/registry';
import { deleteAllData } from '@/core/db/queries/data';
import { isSecretName, maskSecret, type SecretName } from '@/core/secrets/store';
import type { SettingKey } from '@/core/settings/registry';
import { getRuntime } from '../runtime';

/** Secrets the dashboard may set; others belong to integrations that are not enabled yet. */
const EDITABLE_SECRETS: readonly SecretName[] = [
  'openai_api_key',
  'anthropic_api_key',
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
  let value = parsed.data.value;
  if (name === 'webhook_url' || name === 'reddit_proxy_url') {
    // Proxies are usually plain http; webhooks are https.
    const normalized = normalizeWebUrl(value, {
      defaultScheme: name === 'reddit_proxy_url' ? 'http' : 'https',
    });
    if (normalized === null) {
      return {
        ok: false,
        error:
          name === 'webhook_url'
            ? 'Enter the webhook address, for example hooks.slack.com/services/…'
            : 'Enter the proxy address, for example proxy.example.com:8080',
      };
    }
    value = normalized;
  }
  getRuntime().secrets.set(name, value);
  revalidatePath('/settings');
  return Promise.resolve({ ok: true, mask: maskSecret(value) });
}

export async function removeSecret(input: { name: string }): Promise<{ ok: boolean }> {
  if (!isSecretName(input.name) || !EDITABLE_SECRETS.includes(input.name)) return { ok: false };
  const runtime = getRuntime();
  runtime.secrets.remove(input.name);
  // A removed key can no longer use the models it listed.
  const provider = (Object.keys(SECRET_FOR) as ProviderId[]).find(
    (id) => SECRET_FOR[id] === input.name,
  );
  if (provider) forgetModelList(runtime.db, provider);
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
    settings.set(key, changes[key]);
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

const SECRET_FOR: Record<ProviderId, SecretName | null> = {
  openai: 'openai_api_key',
  anthropic: 'anthropic_api_key',
  openai_compatible: 'openai_compatible_api_key',
  codex_cli: null,
};

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
