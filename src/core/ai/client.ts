/**
 * The AI client the pipeline uses.
 *
 * Contract: every call resolves the model configured for its stage, checks
 * the budget before spending anything, records usage even when the call
 * fails, validates structured output with Zod, and returns a result value.
 * Provider messages are redacted before they leave this module.
 */
import type { z } from 'zod';
import { CONFIG } from '../config';
import type { Logger } from '../log';
import type { SecretName, SecretStore } from '../secrets/store';
import type { SettingsStore } from '../settings/store';
import {
  TASK_STAGE,
  type AiResult,
  type AiStage,
  type AiSubject,
  type AiTask,
  type AiUsage,
  type Generator,
  type ModelRef,
  type ProviderCredentials,
  type ProviderId,
} from './types';

export type ModelResolution =
  | { ok: true; model: ModelRef; credentials: ProviderCredentials }
  | { ok: false; kind: 'not_configured' | 'missing_key'; message: string; model: ModelRef | null };

export interface UsageRecorder {
  /** Whether another call may start without exceeding a budget cap. */
  check(): { ok: true } | { ok: false; message: string };
  /** Stores the usage of one call and returns its cost, or null when the price is unknown. */
  record(task: AiTask, model: ModelRef, usage: AiUsage): number | null;
}

export interface AiCall {
  task: AiTask;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  subject?: AiSubject;
  imageUrl?: string;
}

export interface AiClient {
  object<T>(call: AiCall & { schema: z.ZodType<T> }): Promise<AiResult<T>>;
  text(call: AiCall): Promise<AiResult<string>>;
}

export interface AiClientOptions {
  generator: Generator;
  resolveModel: (stage: AiStage) => ModelResolution;
  usage: UsageRecorder;
  redact: (text: string) => string;
  log: Logger;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 1_500;

export function createAiClient(options: AiClientOptions): AiClient {
  const { generator, resolveModel, usage, redact, log } = options;

  async function run(call: AiCall, schema: z.ZodType | null): Promise<AiResult<unknown>> {
    const resolution = resolveModel(TASK_STAGE[call.task]);
    if (!resolution.ok) {
      return {
        ok: false,
        kind: resolution.kind,
        message: resolution.message,
        model: resolution.model,
      };
    }
    const { model, credentials } = resolution;
    const budget = usage.check();
    if (!budget.ok) return { ok: false, kind: 'budget', message: budget.message, model };

    const response = await generator({
      task: call.task,
      model,
      credentials,
      system: call.system,
      prompt: call.prompt,
      schema,
      maxOutputTokens: call.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      timeoutMs: CONFIG.ai.requestTimeoutMs,
      subject: call.subject ?? {},
      ...(call.imageUrl ? { imageUrl: call.imageUrl } : {}),
    });
    const costUsd = usage.record(call.task, model, response.usage);

    if (!response.ok) {
      const message = redact(response.message);
      log.warn('AI call failed', {
        task: call.task,
        model: model.model,
        kind: response.kind,
        message,
      });
      return { ok: false, kind: response.kind, message, model };
    }
    if (schema === null) {
      return typeof response.output === 'string'
        ? { ok: true, value: response.output, usage: response.usage, costUsd, model }
        : { ok: false, kind: 'invalid_output', message: 'Expected text from the model', model };
    }
    const parsed = schema.safeParse(response.output);
    if (!parsed.success) {
      log.warn('AI output failed validation', { task: call.task, model: model.model });
      return {
        ok: false,
        kind: 'invalid_output',
        message: 'The model returned output that did not match the expected format',
        model,
      };
    }
    return { ok: true, value: parsed.data, usage: response.usage, costUsd, model };
  }

  return {
    object: <T>(call: AiCall & { schema: z.ZodType<T> }) =>
      run(call, call.schema) as Promise<AiResult<T>>,
    text: (call) => run(call, null) as Promise<AiResult<string>>,
  };
}

/** The key each provider needs; the CLI provider uses the CLI's own sign-in. */
const PROVIDER_SECRET: Record<ProviderId, SecretName | null> = {
  openai: 'openai_api_key',
  anthropic: 'anthropic_api_key',
  openai_compatible: 'openai_compatible_api_key',
  codex_cli: null,
};

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openai_compatible: 'the OpenAI-compatible endpoint',
  codex_cli: 'the Codex CLI',
};

/** Resolves a stage's model and credentials from settings and the secret store. */
export function createModelResolver(
  settings: SettingsStore,
  secrets: SecretStore,
  options: { cliProviders?: boolean } = {},
): (stage: AiStage) => ModelResolution {
  return (stage) => {
    const model = settings.get('ai.stages')[stage];
    if (model === null) {
      return {
        ok: false,
        kind: 'not_configured',
        message: `Choose a model for the ${stage} stage in Settings.`,
        model: null,
      };
    }
    const baseUrl = settings.get('ai.compatibleBaseUrl');
    if (model.provider === 'openai_compatible' && baseUrl === null) {
      return {
        ok: false,
        kind: 'not_configured',
        message: 'Set the base URL of the OpenAI-compatible endpoint in Settings.',
        model,
      };
    }
    const secret = PROVIDER_SECRET[model.provider];
    if (secret === null) {
      return options.cliProviders
        ? { ok: true, model, credentials: { apiKey: '', baseUrl: null } }
        : {
            ok: false,
            kind: 'not_configured',
            message: `${PROVIDER_LABEL[model.provider]} is experimental. Set EXPERIMENTAL_CLI_PROVIDERS=1 to use it, or choose another provider in Settings.`,
            model,
          };
    }
    const key = secrets.use(secret);
    if (!key.ok && model.provider !== 'openai_compatible') {
      return {
        ok: false,
        kind: 'missing_key',
        message:
          key.kind === 'unreadable'
            ? `The saved ${PROVIDER_LABEL[model.provider]} key can no longer be read. Enter it again in Settings.`
            : `Add an API key for ${PROVIDER_LABEL[model.provider]} in Settings.`,
        model,
      };
    }
    return {
      ok: true,
      model,
      credentials: { apiKey: key.ok ? key.value : '', baseUrl },
    };
  };
}
