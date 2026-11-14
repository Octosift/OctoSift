/**
 * The only module that calls AI providers over the network.
 *
 * It builds AI SDK models from explicit credentials (providers never fall
 * back to environment variables), runs one generation, and turns every
 * failure into a value. It also lists a provider's models for the model
 * picker and runs the one-token connection test.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';
import type {
  AiUsage,
  GenerateRequest,
  GenerateResponse,
  Generator,
  ModelRef,
  ProviderCredentials,
} from './types';

export type ModelFactory = (model: ModelRef, credentials: ProviderCredentials) => LanguageModel;

export const sdkModelFactory: ModelFactory = (model, { apiKey, baseUrl }) => {
  switch (model.provider) {
    case 'openai':
      return createOpenAI({ apiKey })(model.model);
    case 'anthropic':
      return createAnthropic({ apiKey })(model.model);
    case 'openai_compatible':
      if (baseUrl === null) throw new Error('An OpenAI-compatible model needs a base URL');
      return createOpenAICompatible({
        name: 'openai-compatible',
        apiKey: apiKey.length > 0 ? apiKey : undefined,
        baseURL: baseUrl,
      })(model.model);
  }
};

interface UsageLike {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}

function toUsage(usage: UsageLike | undefined): AiUsage {
  return { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error from the AI provider';
}

export function createSdkGenerator(factory: ModelFactory = sdkModelFactory): Generator {
  return async (request: GenerateRequest): Promise<GenerateResponse> => {
    try {
      const model = factory(request.model, request.credentials);
      const input = request.imageUrl
        ? {
            messages: [
              {
                role: 'user' as const,
                content: [
                  { type: 'text' as const, text: request.prompt },
                  { type: 'image' as const, image: new URL(request.imageUrl) },
                ],
              },
            ],
          }
        : { prompt: request.prompt };
      const common = {
        model,
        system: request.system,
        ...input,
        maxOutputTokens: request.maxOutputTokens,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(request.timeoutMs),
      };
      if (request.schema) {
        const result = await generateText({
          ...common,
          output: Output.object({ schema: request.schema }),
        });
        return { ok: true, output: result.output, usage: toUsage(result.usage) };
      }
      const result = await generateText(common);
      return { ok: true, output: result.text, usage: toUsage(result.usage) };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        return {
          ok: false,
          kind: 'invalid_output',
          message: 'The model returned output that did not match the expected format',
          usage: toUsage(error.usage),
        };
      }
      return {
        ok: false,
        kind: 'provider_error',
        message: errorMessage(error),
        usage: toUsage(undefined),
      };
    }
  };
}

export type ConnectionTest =
  { ok: true; model: string; latencyMs: number } | { ok: false; message: string };

/** Sends a tiny request to confirm the key, model and endpoint work. */
export async function testConnection(
  generator: Generator,
  model: ModelRef,
  credentials: ProviderCredentials,
  now: () => number,
): Promise<ConnectionTest> {
  const started = now();
  const response = await generator({
    task: 'test',
    model,
    credentials,
    system: 'Reply with the single word OK.',
    prompt: 'OK?',
    schema: null,
    maxOutputTokens: 5,
    timeoutMs: 30_000,
    subject: {},
  });
  if (!response.ok) return { ok: false, message: response.message };
  return { ok: true, model: model.model, latencyMs: now() - started };
}

export type ModelListResult = { ok: true; models: string[] } | { ok: false; message: string };

interface ListEndpoint {
  url: string;
  headers: Record<string, string>;
  read: (body: unknown) => string[];
}

function readIds(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const list: unknown = (body as Record<string, unknown>).data;
  if (!Array.isArray(list)) return [];
  return list
    .map((item: unknown) =>
      typeof item === 'object' && item !== null ? (item as Record<string, unknown>).id : null,
    )
    .filter((id): id is string => typeof id === 'string');
}

function listEndpoint(
  provider: ModelRef['provider'],
  credentials: ProviderCredentials,
): ListEndpoint {
  const bearer: Record<string, string> =
    credentials.apiKey.length > 0 ? { Authorization: `Bearer ${credentials.apiKey}` } : {};
  switch (provider) {
    case 'openai':
      return {
        url: 'https://api.openai.com/v1/models',
        headers: bearer,
        read: readIds,
      };
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models?limit=100',
        headers: { 'x-api-key': credentials.apiKey, 'anthropic-version': '2023-06-01' },
        read: readIds,
      };
    case 'openai_compatible':
      return {
        url: `${(credentials.baseUrl ?? '').replace(/\/+$/, '')}/models`,
        headers: bearer,
        read: readIds,
      };
  }
}

/** Model ids offered as suggestions; the user can always type any id. */
export async function listModels(
  provider: ModelRef['provider'],
  credentials: ProviderCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelListResult> {
  if (provider === 'openai_compatible' && !credentials.baseUrl) {
    return { ok: false, message: 'Set the base URL of the OpenAI-compatible endpoint first' };
  }
  const endpoint = listEndpoint(provider, credentials);
  try {
    const response = await fetchImpl(endpoint.url, {
      headers: endpoint.headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      return { ok: false, message: `The provider answered HTTP ${response.status}` };
    const models = endpoint.read(await response.json()).sort();
    return { ok: true, models };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}
