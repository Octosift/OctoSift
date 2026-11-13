/**
 * Stops a scan's AI work when it is clearly not going to succeed.
 *
 * A missing model or key stops at once with the setup message. When more
 * than a configured share of calls fail (after a minimum number of calls),
 * the provider is probably down or misconfigured, so the scan stops and
 * reports the last error instead of burning through every post.
 */
import type { AiClient } from '../ai/client';
import type { AiResult } from '../ai/types';

export interface AiGuard {
  ai: AiClient;
  /** The reason AI work stopped, or null while it may continue. */
  tripped(): string | null;
  stats(): { calls: number; failures: number };
}

export function guardAi(
  ai: AiClient,
  options: { maxFailureRatio: number; minCalls: number },
): AiGuard {
  let calls = 0;
  let failures = 0;
  let reason: string | null = null;

  function observe<T>(result: AiResult<T>): AiResult<T> {
    if (result.ok) {
      calls += 1;
      return result;
    }
    if (result.kind === 'budget') return result;
    if (result.kind === 'not_configured' || result.kind === 'missing_key') {
      reason ??= result.message;
      return result;
    }
    calls += 1;
    failures += 1;
    if (calls >= options.minCalls && failures / calls > options.maxFailureRatio) {
      reason ??= `Stopped after ${failures} of ${calls} AI calls failed. Last error: ${result.message}`;
    }
    return result;
  }

  function stopped<T>(): AiResult<T> {
    return { ok: false, kind: 'provider_error', message: reason ?? 'AI work stopped', model: null };
  }

  return {
    ai: {
      object: async (call) => (reason ? stopped() : observe(await ai.object(call))),
      text: async (call) => (reason ? stopped() : observe(await ai.text(call))),
    },
    tripped: () => reason,
    stats: () => ({ calls, failures }),
  };
}
