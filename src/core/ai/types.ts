/** Shapes shared by the AI layer. */
import type { z } from 'zod';
import type { AiStage, ProviderId } from '../settings/registry';

export type { AiStage, ProviderId };

/** What a call is for. Several tasks share the model chosen for one stage. */
export type AiTask =
  'triage' | 'qualify' | 'draft' | 'review' | 'profile' | 'subreddits' | 'rules' | 'image' | 'test';

/** Which configured stage model each task uses. */
export const TASK_STAGE: Record<AiTask, AiStage> = {
  triage: 'triage',
  qualify: 'qualify',
  draft: 'draft',
  review: 'review',
  profile: 'qualify',
  subreddits: 'qualify',
  rules: 'triage',
  image: 'qualify',
  test: 'triage',
};

export interface ModelRef {
  provider: ProviderId;
  model: string;
}

export interface ProviderCredentials {
  /** Empty for local OpenAI-compatible servers that need no key. */
  apiKey: string;
  baseUrl: string | null;
}

/** Prices per million tokens, as stored in the price table. */
export interface ModelPrice {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cachedInputPerMillionUsd?: number | undefined;
}

export interface AiUsage {
  /** All input tokens, cached ones included. */
  inputTokens: number;
  outputTokens: number;
  /** The part of the input served from the provider's prompt cache, when reported. */
  cachedInputTokens?: number;
}

/**
 * Structured hints about what a call concerns. They are used for logging and
 * by the fake generator; real models only see the prompt.
 */
export interface AiSubject {
  postIds?: string[];
  productName?: string;
  productUrl?: string;
  mode?: string;
  linksAllowed?: boolean;
}

export interface GenerateRequest {
  task: AiTask;
  model: ModelRef;
  credentials: ProviderCredentials;
  system: string;
  prompt: string;
  /** When present the model must return an object matching it. */
  schema: z.ZodType | null;
  maxOutputTokens: number;
  timeoutMs: number;
  subject: AiSubject;
  /** An image sent with the prompt, for models that accept images. */
  imageUrl?: string;
}

export type GenerateFailureKind = 'invalid_output' | 'provider_error';

export type GenerateResponse =
  | { ok: true; output: unknown; usage: AiUsage }
  | { ok: false; kind: GenerateFailureKind; message: string; usage: AiUsage };

/** One call to a language model. The real one uses the AI SDK; tests use a fake. */
export type Generator = (request: GenerateRequest) => Promise<GenerateResponse>;

export type AiFailureKind =
  'not_configured' | 'missing_key' | 'budget' | 'invalid_output' | 'provider_error';

export type AiResult<T> =
  | { ok: true; value: T; usage: AiUsage; costUsd: number | null; model: ModelRef }
  | { ok: false; kind: AiFailureKind; message: string; model: ModelRef | null };
