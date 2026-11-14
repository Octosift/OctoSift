'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { applyPreset } from '@/core/ai/apply-preset';
import { storeModelList } from '@/core/ai/model-lists';
import { checkCodexLogin, findCodexBin, type CodexLogin } from '@/core/ai/codex';
import { CATALOG, PRESET_IDS, PRESET_PROVIDERS } from '@/core/ai/presets';
import { listModels } from '@/core/ai/provider';
import { AI_STAGES, PROVIDER_IDS, type ProviderId } from '@/core/settings/registry';
import type { SecretName } from '@/core/secrets/store';
import { getRuntime, nowSeconds } from '../runtime';

const KEY_FOR: Record<ProviderId, SecretName | null> = {
  openai: 'openai_api_key',
  anthropic: 'anthropic_api_key',
  openai_compatible: 'openai_compatible_api_key',
  codex_cli: null,
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
  const secret = KEY_FOR[parsed.data];
  // The CLI has no model list; its models are the recommended ones.
  if (secret === null) return { ok: true, models: CATALOG.codex_cli.map((model) => model.id) };
  const key = runtime.secrets.use(secret);
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

const CLI_OFF =
  'The Codex CLI provider is experimental. Set EXPERIMENTAL_CLI_PROVIDERS=1 in .env first.';

/** Whether the Codex CLI is installed and signed in. */
export async function checkCodex(): Promise<CodexLogin> {
  const runtime = getRuntime();
  if (!runtime.env.EXPERIMENTAL_CLI_PROVIDERS) return { ok: false, message: CLI_OFF };
  return checkCodexLogin({
    bin: findCodexBin(process.env),
    env: process.env,
    redact: runtime.redactor.redact,
  });
}

export type CodexTest =
  | {
      ok: true;
      model: string;
      latencyMs: number;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
    }
  | { ok: false; message: string };

/** The sign-in check plus one tiny call with an output schema. */
export async function testCodex(): Promise<CodexTest> {
  const login = await checkCodex();
  if (!login.ok) return login;
  const runtime = getRuntime();
  const stage = runtime.settings.get('ai.stages').triage;
  const model = stage?.provider === 'codex_cli' ? stage.model : (CATALOG.codex_cli[0]?.id ?? '');
  const started = runtime.clock.nowMs();
  const response = await runtime.generator({
    task: 'test',
    model: { provider: 'codex_cli', model },
    credentials: { apiKey: '', baseUrl: null },
    system: 'Answer with a JSON object whose "ok" field is true.',
    prompt: 'Is the connection working?',
    schema: z.object({ ok: z.boolean() }),
    maxOutputTokens: 50,
    timeoutMs: 180_000,
    subject: {},
  });
  if (!response.ok) return { ok: false, message: response.message };
  return {
    ok: true,
    model,
    latencyMs: runtime.clock.nowMs() - started,
    inputTokens: response.usage.inputTokens,
    cachedInputTokens: response.usage.cachedInputTokens ?? 0,
    outputTokens: response.usage.outputTokens,
  };
}
