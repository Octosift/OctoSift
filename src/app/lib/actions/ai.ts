'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { applyPreset } from '@/core/ai/apply-preset';
import { storeModelList } from '@/core/ai/model-lists';
import { PRESET_IDS, PRESET_PROVIDERS } from '@/core/ai/presets';
import { listModels } from '@/core/ai/provider';
import { AI_STAGES, PROVIDER_IDS, type ProviderId } from '@/core/settings/registry';
import type { SecretName } from '@/core/secrets/store';
import { getRuntime, nowSeconds } from '../runtime';

const KEY_FOR: Record<ProviderId, SecretName> = {
  openai: 'openai_api_key',
  anthropic: 'anthropic_api_key',
  openai_compatible: 'openai_compatible_api_key',
};

export type ModelListResult = { ok: true; models: string[] } | { ok: false; message: string };

/** Asks the provider which models the saved key can use, and remembers the answer. */
export async function refreshModelList(provider: string): Promise<ModelListResult> {
  const parsed = z.enum(PROVIDER_IDS).safeParse(provider);
  if (!parsed.success) return { ok: false, message: 'Unknown provider' };
  const runtime = getRuntime();
  if (runtime.env.DEMO_MODE) {
    return { ok: true, models: AI_STAGES.map((stage) => `demo-${stage}`) };
  }
  const key = runtime.secrets.use(KEY_FOR[parsed.data]);
  if (!key.ok && parsed.data !== 'openai_compatible') {
    return { ok: false, message: 'Save an API key for this provider first.' };
  }
  const result = await listModels(parsed.data, {
    apiKey: key.ok ? key.value : '',
    baseUrl: runtime.settings.get('ai.compatibleBaseUrl'),
  });
  if (!result.ok) return { ok: false, message: runtime.redactor.redact(result.message) };
  const models = storeModelList(runtime.db, parsed.data, result.models, nowSeconds());
  revalidatePath('/settings');
  revalidatePath('/onboarding');
  return { ok: true, models };
}

const presetInput = z.object({ provider: z.enum(PRESET_PROVIDERS), preset: z.enum(PRESET_IDS) });

export async function choosePreset(
  input: z.input<typeof presetInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = presetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Unknown provider or preset' };
  applyPreset(getRuntime().settings, parsed.data.provider, parsed.data.preset);
  revalidatePath('/', 'layout');
  return Promise.resolve({ ok: true });
}
