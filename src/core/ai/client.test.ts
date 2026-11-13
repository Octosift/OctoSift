import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openMemoryDatabase } from '../db/client';
import { silentLogger } from '../log';
import { createRedactor } from '../secrets/redact';
import { createSecretStore } from '../secrets/store';
import { createSettingsStore } from '../settings/store';
import { FAKE_KEYS } from '../testing/fake-secrets';
import {
  createAiClient,
  createModelResolver,
  type ModelResolution,
  type UsageRecorder,
} from './client';
import { createFakeGenerator, type FakeReply } from './fake';
import type { AiStage, ModelRef } from './types';

const schema = z.object({ relevant: z.boolean() });
const MODEL: ModelRef = { provider: 'openai', model: 'small-model' };

function setup(
  reply: FakeReply,
  options: { resolve?: (stage: AiStage) => ModelResolution; budgetOk?: boolean } = {},
) {
  const generator = createFakeGenerator(() => reply);
  const recorded: { task: string; model: ModelRef; tokens: number }[] = [];
  const usage: UsageRecorder = {
    check: () =>
      options.budgetOk === false ? { ok: false, message: 'Run budget reached' } : { ok: true },
    record: (task, model, used) => {
      recorded.push({ task, model, tokens: used.inputTokens + used.outputTokens });
      return 0.001;
    },
  };
  const redactor = createRedactor();
  redactor.remember(FAKE_KEYS.openAi);
  const client = createAiClient({
    generator,
    resolveModel:
      options.resolve ??
      ((stage) => ({
        ok: true,
        model: { ...MODEL, model: `${stage}-model` },
        credentials: { apiKey: FAKE_KEYS.openAi, baseUrl: null },
      })),
    usage,
    redact: redactor.redact,
    log: silentLogger(),
  });
  return { client, generator, recorded };
}

const call = { task: 'triage' as const, system: 's', prompt: 'p', schema };

describe('AI client', () => {
  it('returns the validated object with its usage and cost', async () => {
    const { client, recorded } = setup({ output: { relevant: true } });
    const result = await client.object(call);
    expect(result).toMatchObject({ ok: true, value: { relevant: true }, costUsd: 0.001 });
    expect(recorded).toHaveLength(1);
  });

  it('uses the model of the stage a task belongs to', async () => {
    const { client, generator } = setup({ output: { relevant: true } });
    await client.object({ ...call, task: 'profile' });
    expect(generator.calls[0]?.model.model).toBe('qualify-model');
  });

  it('does not call the model when the stage has no model configured', async () => {
    const { client, generator } = setup(
      { output: {} },
      {
        resolve: () => ({
          ok: false,
          kind: 'not_configured',
          message: 'Choose a model',
          model: null,
        }),
      },
    );
    expect(await client.object(call)).toMatchObject({ ok: false, kind: 'not_configured' });
    expect(generator.calls).toHaveLength(0);
  });

  it('does not call the model when the budget is used up', async () => {
    const { client, generator } = setup({ output: {} }, { budgetOk: false });
    expect(await client.object(call)).toMatchObject({
      ok: false,
      kind: 'budget',
      message: 'Run budget reached',
    });
    expect(generator.calls).toHaveLength(0);
  });

  it('rejects output that does not match the schema but still records the usage', async () => {
    const { client, recorded } = setup({ output: { relevant: 'yes' } });
    expect(await client.object(call)).toMatchObject({ ok: false, kind: 'invalid_output' });
    expect(recorded).toHaveLength(1);
  });

  it('redacts secrets from provider error messages', async () => {
    const { client } = setup({
      fail: 'provider_error',
      message: `Incorrect API key provided: ${FAKE_KEYS.openAi}`,
    });
    const result = await client.object(call);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(FAKE_KEYS.openAi);
  });

  it('returns text for text calls', async () => {
    const { client } = setup({ output: 'A short description.' });
    expect(await client.text({ task: 'image', system: 's', prompt: 'p' })).toMatchObject({
      ok: true,
      value: 'A short description.',
    });
  });
});

describe('model resolver', () => {
  function stores(env: Record<string, string> = {}) {
    const db = openMemoryDatabase();
    const settings = createSettingsStore(db);
    const secrets = createSecretStore({
      db,
      key: Buffer.alloc(32, 3),
      env,
      redactor: createRedactor(),
      now: () => 0,
    });
    return { settings, secrets, resolve: createModelResolver(settings, secrets) };
  }

  const stages = (triage: ModelRef | null) => ({
    triage,
    qualify: null,
    draft: null,
    review: null,
  });

  it('asks the user to choose a model when the stage has none', () => {
    const { resolve } = stores();
    expect(resolve('triage')).toMatchObject({ ok: false, kind: 'not_configured' });
  });

  it('asks for an API key when the provider has none', () => {
    const { settings, resolve } = stores();
    settings.set('ai.stages', stages({ provider: 'anthropic', model: 'm' }));
    const result = resolve('triage');
    expect(result).toMatchObject({ ok: false, kind: 'missing_key' });
    expect(result.ok ? '' : result.message).toContain('Anthropic');
  });

  it('uses a key from the environment', () => {
    const { settings, resolve } = stores({ OPENAI_API_KEY: FAKE_KEYS.openAi });
    settings.set('ai.stages', stages({ provider: 'openai', model: 'm' }));
    expect(resolve('triage')).toEqual({
      ok: true,
      model: { provider: 'openai', model: 'm' },
      credentials: { apiKey: FAKE_KEYS.openAi, baseUrl: null },
    });
  });

  it('requires a base URL but no key for an OpenAI-compatible endpoint', () => {
    const { settings, resolve } = stores();
    settings.set('ai.stages', stages({ provider: 'openai_compatible', model: 'local' }));
    expect(resolve('triage')).toMatchObject({ ok: false, kind: 'not_configured' });
    settings.set('ai.compatibleBaseUrl', 'http://localhost:11434/v1');
    expect(resolve('triage')).toMatchObject({
      ok: true,
      credentials: { apiKey: '', baseUrl: 'http://localhost:11434/v1' },
    });
  });
});
