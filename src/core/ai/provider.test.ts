import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FAKE_KEYS } from '../testing/fake-secrets';
import { createSdkGenerator, listModels, testConnection, type ModelFactory } from './provider';
import type { GenerateRequest } from './types';

function mockModel(text: string | Error) {
  return new MockLanguageModelV4({
    doGenerate: () => {
      if (text instanceof Error) return Promise.reject(text);
      return Promise.resolve({
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 30, text: 30, reasoning: undefined },
        },
        warnings: [],
      });
    },
  });
}

function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    task: 'triage',
    model: { provider: 'openai', model: 'small-model' },
    credentials: { apiKey: FAKE_KEYS.openAi, baseUrl: null },
    system: 'system',
    prompt: 'prompt',
    schema: null,
    maxOutputTokens: 100,
    timeoutMs: 5_000,
    subject: {},
    ...overrides,
  };
}

const schema = z.object({ relevant: z.boolean() });

describe('SDK generator', () => {
  it('returns a structured object with token usage', async () => {
    const factory: ModelFactory = () => mockModel('{"relevant":true}');
    const result = await createSdkGenerator(factory)(request({ schema }));
    expect(result).toEqual({
      ok: true,
      output: { relevant: true },
      usage: { inputTokens: 120, outputTokens: 30 },
    });
  });

  it('returns plain text when no schema is given', async () => {
    const result = await createSdkGenerator(() => mockModel('Hello there'))(request());
    expect(result).toMatchObject({ ok: true, output: 'Hello there' });
  });

  it('reports output that does not match the schema, keeping the usage', async () => {
    const result = await createSdkGenerator(() => mockModel('{"relevant":"maybe"}'))(
      request({ schema }),
    );
    expect(result).toMatchObject({
      ok: false,
      kind: 'invalid_output',
      usage: { inputTokens: 120, outputTokens: 30 },
    });
  });

  it('turns provider errors into values', async () => {
    const result = await createSdkGenerator(() => mockModel(new Error('quota exceeded')))(
      request(),
    );
    expect(result).toMatchObject({ ok: false, kind: 'provider_error' });
    expect(result.ok ? '' : result.message).toContain('quota exceeded');
  });

  it('reports a missing base URL for an OpenAI-compatible model as a provider error', async () => {
    const result = await createSdkGenerator()(
      request({ model: { provider: 'openai_compatible', model: 'local' } }),
    );
    expect(result).toMatchObject({ ok: false, kind: 'provider_error' });
  });
});

describe('testConnection', () => {
  it('reports the model and the latency of a successful call', async () => {
    let now = 1_000;
    const generator = createSdkGenerator(() => {
      now += 250;
      return mockModel('OK');
    });
    const result = await testConnection(
      generator,
      { provider: 'anthropic', model: 'any-model' },
      { apiKey: FAKE_KEYS.anthropic, baseUrl: null },
      () => now,
    );
    expect(result).toEqual({ ok: true, model: 'any-model', latencyMs: 250 });
  });

  it('reports the provider message when the call fails', async () => {
    const generator = createSdkGenerator(() => mockModel(new Error('invalid x-api-key')));
    const result = await testConnection(
      generator,
      { provider: 'anthropic', model: 'any-model' },
      { apiKey: 'wrong', baseUrl: null },
      () => 0,
    );
    expect(result).toEqual({ ok: false, message: 'invalid x-api-key' });
  });
});

describe('listModels', () => {
  function fakeFetch(status: number, body: unknown) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const impl = (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    };
    return { calls, impl };
  }

  it('lists OpenAI models with a bearer token', async () => {
    const { calls, impl } = fakeFetch(200, { data: [{ id: 'model-b' }, { id: 'model-a' }] });
    const result = await listModels('openai', { apiKey: FAKE_KEYS.openAi, baseUrl: null }, impl);
    expect(result).toEqual({ ok: true, models: ['model-a', 'model-b'] });
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${FAKE_KEYS.openAi}`);
  });

  it('lists Anthropic models with the API key header', async () => {
    const { calls, impl } = fakeFetch(200, { data: [{ id: 'model-x' }] });
    await listModels('anthropic', { apiKey: FAKE_KEYS.anthropic, baseUrl: null }, impl);
    expect(calls[0]?.headers['x-api-key']).toBe(FAKE_KEYS.anthropic);
  });

  it('strips the "models/" prefix from Google model names', async () => {
    const { impl } = fakeFetch(200, { models: [{ name: 'models/gem-1' }] });
    const result = await listModels('google', { apiKey: FAKE_KEYS.google, baseUrl: null }, impl);
    expect(result).toEqual({ ok: true, models: ['gem-1'] });
  });

  it('lists models from an OpenAI-compatible endpoint at its base URL', async () => {
    const { calls, impl } = fakeFetch(200, { data: [{ id: 'local-model' }] });
    await listModels(
      'openai_compatible',
      { apiKey: '', baseUrl: 'http://localhost:1234/v1/' },
      impl,
    );
    expect(calls[0]?.url).toBe('http://localhost:1234/v1/models');
    expect(calls[0]?.headers.Authorization).toBeUndefined();
  });

  it('asks for a base URL before listing OpenAI-compatible models', async () => {
    const { calls, impl } = fakeFetch(200, {});
    const result = await listModels('openai_compatible', { apiKey: '', baseUrl: null }, impl);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reports HTTP errors', async () => {
    const { impl } = fakeFetch(401, { error: 'bad key' });
    expect(await listModels('openai', { apiKey: 'x', baseUrl: null }, impl)).toEqual({
      ok: false,
      message: 'The provider answered HTTP 401',
    });
  });
});
