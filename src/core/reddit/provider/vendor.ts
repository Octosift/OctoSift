/**
 * A paid Reddit data provider: Vendor's Reddit app endpoints.
 *
 * Bearer-key authentication, at most a few requests a second through its own
 * limiter, two retries with backoff for network errors and server errors.
 * Every answer is JSON with a `code`; only code 200 is billed. The key is
 * passed in for each request and never logged.
 */
import { z } from 'zod';
import type { Clock } from '../../clock';
import { CONFIG } from '../../config';
import type { RateLimiter } from '../ratelimit';
import type { FetchFailureKind } from '../types';

export const VENDOR_ORIGIN = 'https://api.data-vendor.example';

export type ProviderAnswer =
  | { ok: true; data: unknown }
  | { ok: false; kind: FetchFailureKind; message: string; status?: number };

export interface ProviderClient {
  /** GET an endpoint; `billed` tells the caller whether the request cost money. */
  get(path: string, params: Record<string, string>): Promise<ProviderAnswer & { billed: boolean }>;
}

const envelope = z.object({
  code: z.number(),
  message: z.string().nullish(),
  data: z.unknown().optional(),
});

export interface VendorClientOptions {
  key: () => string | null;
  limiter: RateLimiter;
  clock: Clock;
  redact: (text: string) => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function failureFor(status: number, message: string): FetchFailureKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'gone';
  if (status === 429 || /rate.?limit|too many|quota/i.test(message)) return 'rate_limited';
  return 'network';
}

export function createVendorClient(options: VendorClientOptions): ProviderClient {
  const { limiter, clock, redact, fetchImpl = fetch } = options;
  const timeoutMs = options.timeoutMs ?? CONFIG.provider.timeoutMs;

  async function attempt(
    url: string,
    key: string,
  ): Promise<(ProviderAnswer & { billed: boolean }) | { retry: true; message: string }> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { retry: true, message: 'Could not reach the data provider' };
    }
    if (response.status >= 500) {
      await response.body?.cancel();
      return { retry: true, message: `The data provider answered HTTP ${String(response.status)}` };
    }
    const body = envelope.safeParse(await response.json().catch(() => null));
    if (!body.success) {
      return {
        ok: false,
        kind: response.ok ? 'network' : failureFor(response.status, ''),
        message: 'The data provider sent an unexpected answer',
        billed: false,
      };
    }
    if (body.data.code !== 200 || !response.ok) {
      const message = redact(body.data.message ?? `code ${String(body.data.code)}`);
      const status = response.ok ? body.data.code : response.status;
      return { ok: false, kind: failureFor(status, message), message, status, billed: false };
    }
    return { ok: true, data: body.data.data ?? null, billed: true };
  }

  return {
    async get(path, params) {
      const key = options.key();
      if (!key)
        return { ok: false, kind: 'auth', message: 'No data provider key is set', billed: false };
      const url = `${VENDOR_ORIGIN}${path}?${new URLSearchParams(params).toString()}`;
      let lastError = 'The data provider failed';
      for (let tries = 0; tries <= CONFIG.provider.retries; tries += 1) {
        if (tries > 0) await clock.sleep(CONFIG.provider.retryBackoffMs * tries);
        const turn = await limiter.run(() => attempt(url, key));
        if (turn.status === 'paused') {
          return {
            ok: false,
            kind: 'rate_limited',
            message: 'Data provider paused',
            billed: false,
          };
        }
        const result = turn.value;
        if (!('retry' in result)) return result;
        lastError = result.message;
      }
      return { ok: false, kind: 'network', message: lastError, billed: false };
    },
  };
}
