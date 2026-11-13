/**
 * A deterministic stand-in for a language model, used by every test and by
 * demo mode. It implements the same Generator contract as the real provider,
 * so budgets, usage records and output validation run exactly as they would
 * against a real model. Token counts are estimated from text length.
 */
import type { GenerateRequest, GenerateResponse, Generator } from './types';

export type FakeReply =
  { output: unknown } | { fail: 'invalid_output' | 'provider_error'; message?: string };

export interface FakeGenerator extends Generator {
  calls: GenerateRequest[];
}

/** Roughly four characters per token, as for English text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function createFakeGenerator(
  respond: (request: GenerateRequest) => FakeReply,
): FakeGenerator {
  const calls: GenerateRequest[] = [];
  const generator = (request: GenerateRequest): Promise<GenerateResponse> => {
    calls.push(request);
    const inputTokens = estimateTokens(request.system + request.prompt);
    const reply = respond(request);
    if ('fail' in reply) {
      return Promise.resolve({
        ok: false,
        kind: reply.fail,
        message: reply.message ?? 'Fake failure',
        usage: { inputTokens, outputTokens: 0 },
      });
    }
    const outputText =
      typeof reply.output === 'string' ? reply.output : JSON.stringify(reply.output);
    return Promise.resolve({
      ok: true,
      output: reply.output,
      usage: { inputTokens, outputTokens: estimateTokens(outputText) },
    });
  };
  return Object.assign(generator, { calls });
}
