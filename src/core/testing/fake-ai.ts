/** Builds an AI client around the fake generator, for tests. */
import { createAiClient, type AiClient } from '../ai/client';
import { createFakeGenerator, type FakeGenerator, type FakeReply } from '../ai/fake';
import type { GenerateRequest } from '../ai/types';
import { silentLogger } from '../log';

export interface FakeAiOptions {
  /** Number of calls allowed before the budget check fails. */
  budgetCalls?: number;
}

export function fakeAiClient(
  respond: (request: GenerateRequest) => FakeReply,
  options: FakeAiOptions = {},
): { ai: AiClient; generator: FakeGenerator } {
  const generator = createFakeGenerator(respond);
  const ai = createAiClient({
    generator,
    resolveModel: (stage) => ({
      ok: true,
      model: { provider: 'openai_compatible', model: `fake-${stage}` },
      credentials: { apiKey: '', baseUrl: 'http://localhost:0' },
    }),
    usage: {
      check: () =>
        options.budgetCalls !== undefined && generator.calls.length >= options.budgetCalls
          ? { ok: false, message: 'Budget reached' }
          : { ok: true },
      record: () => 0,
    },
    redact: (text) => text,
    log: silentLogger(),
  });
  return { ai, generator };
}
