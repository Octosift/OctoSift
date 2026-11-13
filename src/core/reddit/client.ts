/**
 * The only module that talks to Reddit over HTTP.
 *
 * Contract: `getFeed` never throws. It returns the body of an Atom feed or a
 * typed failure. Blocks (HTTP 429/403, a login redirect, or a block page) are
 * never retried; they pause every Reddit read for a while, because pressing
 * on after a block is how an address gets blocked for longer. Network errors
 * and server errors are retried with exponential backoff.
 */
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import type { Clock } from '../clock';
import { CONFIG } from '../config';
import type { Logger } from '../log';
import type { RateLimiter } from './ratelimit';
import type { FetchFailureKind, RateInfo } from './types';

export interface TransportRequest {
  url: string;
  headers: Record<string, string>;
  proxyUrl: string | null;
  timeoutMs: number;
}

/** Performs one HTTP GET without following redirects. */
export type Transport = (request: TransportRequest) => Promise<Response>;

export type FeedResponse =
  | { ok: true; body: string; rate: RateInfo }
  | { ok: false; kind: FetchFailureKind; retryAfterS?: number; message: string };

export interface RedditClient {
  getFeed(path: string): Promise<FeedResponse>;
}

export interface RedditClientOptions {
  transport?: Transport;
  limiter: RateLimiter;
  clock: Clock;
  log: Logger;
  /** Read on every request so changes in Settings apply without a restart. */
  userAgent: () => string;
  proxyUrl: () => string | null;
  /** Called with the time reads resume, so the pause can be persisted. */
  onBlock?: (untilMs: number) => void;
}

/**
 * Default transport. With a proxy, every request gets a fresh agent and
 * therefore a fresh connection, so a rotating proxy can change the exit
 * address between requests.
 */
export const defaultTransport: Transport = async ({ url, headers, proxyUrl, timeoutMs }) => {
  const init = { headers, redirect: 'manual' as const, signal: AbortSignal.timeout(timeoutMs) };
  if (proxyUrl === null) return fetch(url, init);
  const dispatcher = new ProxyAgent(proxyUrl);
  try {
    const response = await undiciFetch(url, { ...init, dispatcher });
    const body = await response.text();
    // Re-wrap so callers always get the platform Response type.
    return new Response(body, {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    });
  } finally {
    await dispatcher.close();
  }
};

type Attempt =
  | { outcome: 'ok'; body: string; rate: RateInfo }
  | {
      outcome: 'block';
      kind: 'blocked' | 'rate_limited';
      retryAfterS: number | null;
      message: string;
    }
  | { outcome: 'gone'; message: string }
  | { outcome: 'retry'; message: string }
  | { outcome: 'fail'; message: string };

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function readRate(headers: Headers): RateInfo {
  return {
    used: headerNumber(headers, 'x-ratelimit-used'),
    remaining: headerNumber(headers, 'x-ratelimit-remaining'),
    resetS: headerNumber(headers, 'x-ratelimit-reset'),
  };
}

function retryAfterSeconds(headers: Headers, nowMs: number): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) return null;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - nowMs) / 1000));
}

function hasBlockMarker(body: string): boolean {
  const lower = body.toLowerCase();
  return CONFIG.reddit.blockMarkers.some((marker) => lower.includes(marker));
}

async function classify(response: Response, nowMs: number): Promise<Attempt> {
  const { status, headers } = response;
  if (status === 429) {
    return {
      outcome: 'block',
      kind: 'rate_limited',
      retryAfterS: retryAfterSeconds(headers, nowMs),
      message: 'Reddit answered HTTP 429 (too many requests)',
    };
  }
  if (status === 403) {
    return {
      outcome: 'block',
      kind: 'blocked',
      retryAfterS: null,
      message: 'Reddit answered HTTP 403',
    };
  }
  if (status >= 300 && status < 400) {
    const location = headers.get('location') ?? '';
    if (/login|challenge|captcha/i.test(location)) {
      return {
        outcome: 'block',
        kind: 'blocked',
        retryAfterS: null,
        message: 'Reddit redirected to a login page',
      };
    }
    // Logged-out feed requests for a subreddit that does not exist are redirected.
    return { outcome: 'gone', message: `Reddit redirected the feed (HTTP ${status})` };
  }
  if (status === 404) return { outcome: 'gone', message: 'Reddit answered HTTP 404' };
  if (status >= 500) return { outcome: 'retry', message: `Reddit answered HTTP ${status}` };
  if (status !== 200) return { outcome: 'fail', message: `Reddit answered HTTP ${status}` };
  const body = await response.text();
  if (hasBlockMarker(body)) {
    return {
      outcome: 'block',
      kind: 'blocked',
      retryAfterS: null,
      message: 'Reddit returned a block page',
    };
  }
  return { outcome: 'ok', body, rate: readRate(headers) };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

export function createRedditClient(options: RedditClientOptions): RedditClient {
  const {
    transport = defaultTransport,
    limiter,
    clock,
    log,
    userAgent,
    proxyUrl,
    onBlock,
  } = options;
  const cache = new Map<string, { expiresAt: number; body: string; rate: RateInfo }>();

  async function attempt(url: string): Promise<Attempt> {
    try {
      const response = await transport({
        url,
        headers: { 'User-Agent': userAgent(), Accept: 'application/atom+xml' },
        proxyUrl: proxyUrl(),
        timeoutMs: CONFIG.reddit.requestTimeoutMs,
      });
      limiter.observe(readRate(response.headers));
      return await classify(response, clock.nowMs());
    } catch (error) {
      return { outcome: 'retry', message: `Network error: ${describeError(error)}` };
    }
  }

  function pauseAll(retryAfterS: number | null): number {
    const pauseMs = Math.max(CONFIG.reddit.blockPauseMs, (retryAfterS ?? 0) * 1000);
    const untilMs = clock.nowMs() + pauseMs;
    limiter.pause(untilMs);
    onBlock?.(untilMs);
    return Math.ceil(pauseMs / 1000);
  }

  async function getFeed(path: string): Promise<FeedResponse> {
    const url = `${CONFIG.reddit.baseUrl}${path}`;
    const cached = cache.get(url);
    if (cached && cached.expiresAt > clock.nowMs()) {
      return { ok: true, body: cached.body, rate: cached.rate };
    }

    let lastMessage = 'no attempt made';
    for (let attemptIndex = 0; attemptIndex <= CONFIG.reddit.maxRetries; attemptIndex += 1) {
      if (attemptIndex > 0)
        await clock.sleep(CONFIG.reddit.retryBaseDelayMs * 2 ** (attemptIndex - 1));
      const turn = await limiter.run(() => attempt(url));
      if (turn.status === 'paused') {
        const retryAfterS = Math.max(1, Math.ceil((turn.untilMs - clock.nowMs()) / 1000));
        const blocked = limiter.pausedUntil() !== null;
        return {
          ok: false,
          kind: blocked ? 'blocked' : 'rate_limited',
          retryAfterS,
          message: blocked
            ? 'Reddit reads are paused after a block'
            : 'Waiting for Reddit rate limit',
        };
      }
      const result = turn.value;
      switch (result.outcome) {
        case 'ok':
          cache.set(url, {
            expiresAt: clock.nowMs() + CONFIG.reddit.cacheTtlMs,
            body: result.body,
            rate: result.rate,
          });
          return { ok: true, body: result.body, rate: result.rate };
        case 'block': {
          const retryAfterS = pauseAll(result.retryAfterS);
          log.warn('Reddit reads paused', { reason: result.message, retryAfterS });
          return { ok: false, kind: result.kind, retryAfterS, message: result.message };
        }
        case 'gone':
          return { ok: false, kind: 'gone', message: result.message };
        case 'fail':
          return { ok: false, kind: 'network', message: result.message };
        case 'retry':
          lastMessage = result.message;
          log.debug('Retrying Reddit request', {
            attempt: attemptIndex + 1,
            reason: result.message,
          });
      }
    }
    return { ok: false, kind: 'network', message: lastMessage };
  }

  return {
    async getFeed(path) {
      try {
        return await getFeed(path);
      } catch (error) {
        // Defensive: the contract is that reads never throw into a scan.
        return { ok: false, kind: 'network', message: `Unexpected error: ${describeError(error)}` };
      }
    },
  };
}
