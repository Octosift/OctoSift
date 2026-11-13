import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AiClient } from '../ai/client';
import type { AiResult } from '../ai/types';
import { guardAi } from './ai-guard';

const schema = z.object({ ok: z.boolean() });
const call = { task: 'triage' as const, system: 's', prompt: 'p', schema };
const model = { provider: 'openai' as const, model: 'm' };

function scripted(results: AiResult<unknown>[]) {
  let calls = 0;
  const ai: AiClient = {
    object: () => {
      calls += 1;
      return Promise.resolve(
        (results.shift() ?? {
          ok: true,
          value: {},
          usage: { inputTokens: 0, outputTokens: 0 },
          costUsd: 0,
          model,
        }) as AiResult<never>,
      );
    },
    text: () => Promise.reject(new Error('unused')),
  };
  return { ai, count: () => calls };
}

const failure = (message: string): AiResult<unknown> => ({
  ok: false,
  kind: 'provider_error',
  message,
  model,
});

describe('guardAi', () => {
  it('stops at once when the model is not configured', async () => {
    const { ai, count } = scripted([
      { ok: false, kind: 'not_configured', message: 'Choose a model', model: null },
    ]);
    const guard = guardAi(ai, { maxFailureRatio: 0.3, minCalls: 5 });
    await guard.ai.object(call);
    expect(guard.tripped()).toBe('Choose a model');
    await guard.ai.object(call);
    expect(count()).toBe(1);
  });

  it('stops when more than the allowed share of calls fail', async () => {
    const { ai } = scripted([
      failure('a'),
      failure('b'),
      { ok: true, value: {}, usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, model },
      { ok: true, value: {}, usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, model },
      failure('last error'),
    ]);
    const guard = guardAi(ai, { maxFailureRatio: 0.3, minCalls: 5 });
    for (let index = 0; index < 4; index += 1) await guard.ai.object(call);
    expect(guard.tripped()).toBeNull();
    await guard.ai.object(call);
    expect(guard.tripped()).toContain('last error');
    expect(guard.stats()).toEqual({ calls: 5, failures: 3 });
  });

  it('does not count budget stops as failures', async () => {
    const { ai } = scripted(
      Array.from(
        { length: 6 },
        () => ({ ok: false, kind: 'budget', message: 'cap', model }) as const,
      ),
    );
    const guard = guardAi(ai, { maxFailureRatio: 0.3, minCalls: 5 });
    for (let index = 0; index < 6; index += 1) await guard.ai.object(call);
    expect(guard.tripped()).toBeNull();
  });
});
