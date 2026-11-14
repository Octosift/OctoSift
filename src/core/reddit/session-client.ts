/**
 * HTTP access to Reddit's JSON listings with the user's own signed-in session.
 *
 * The Cookie header is a secret: it is sent only to www.reddit.com, never
 * logged, and passed in for every request rather than kept here. Requests go
 * one at a time through the session's own limiter. A 401 or 403, a redirect
 * to the login page or a body that is not JSON means the session no longer
 * works: the client reports it once and makes no further requests.
 */
import type { Clock } from '../clock';
import { CONFIG } from '../config';
import type { LimitedResult, RateLimiter } from './ratelimit';

export const SESSION_ORIGIN = 'https://www.reddit.com';

export type SessionFailureKind = 'auth' | 'gone' | 'rate_limited' | 'network';

export type SessionResponse =
  | { ok: true; json: unknown }
  | { ok: false; kind: SessionFailureKind; message: string; retryAfterS?: number };

export interface SessionClient {
  getJson(path: string): Promise<SessionResponse>;
}

export interface SessionClientOptions {
  /** The stored Cookie header, or null when no account is connected. */
  cookie: () => string | null;
  userAgent: () => string;
  limiter: RateLimiter;
  clock: Clock;
  /** Called once when the session stops working, so the app can ask to reconnect. */
  onInvalid: (reason: string) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function invalid(message: string): SessionResponse {
  return { ok: false, kind: 'auth', message };
}

export function createSessionClient(options: SessionClientOptions): SessionClient {
  const { limiter, clock, onInvalid, fetchImpl = fetch } = options;
  const timeoutMs = options.timeoutMs ?? CONFIG.session.timeoutMs;
  let broken: string | null = null;

  function markBroken(reason: string): SessionResponse {
    if (broken === null) {
      broken = reason;
      onInvalid(reason);
    }
    return invalid(reason);
  }

  async function request(path: string): Promise<SessionResponse> {
    const cookie = options.cookie();
    if (!cookie) return invalid('No Reddit account is connected');
    let response: Response;
    try {
      response = await fetchImpl(`${SESSION_ORIGIN}${path}`, {
        headers: {
          Cookie: cookie,
          'User-Agent': options.userAgent(),
          Accept: 'application/json',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // The error may quote the request; report a fixed message so nothing leaks.
      return { ok: false, kind: 'network', message: 'Could not reach Reddit' };
    }
    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = response.headers.get('location') ?? '';
      await response.body?.cancel();
      if (/\/login|\/register/i.test(location)) {
        return markBroken('Reddit asked to sign in again');
      }
      // Reddit redirects listings of subreddits that do not exist to a search page.
      return { ok: false, kind: 'gone', message: `Redirected (HTTP ${String(status)})` };
    }
    if (status === 401 || status === 403) {
      await response.body?.cancel();
      return markBroken(`Reddit refused the session (HTTP ${String(status)})`);
    }
    if (status === 404) {
      await response.body?.cancel();
      return { ok: false, kind: 'gone', message: 'Not found' };
    }
    if (status === 429) {
      await response.body?.cancel();
      const retry = Number(response.headers.get('retry-after'));
      return {
        ok: false,
        kind: 'rate_limited',
        message: 'Reddit asked to slow down',
        ...(Number.isFinite(retry) && retry > 0 ? { retryAfterS: retry } : {}),
      };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, kind: 'network', message: `Reddit answered HTTP ${String(status)}` };
    }
    const text = await response.text();
    try {
      return { ok: true, json: JSON.parse(text) as unknown };
    } catch {
      // An HTML block or sign-in page instead of JSON.
      return markBroken('Reddit sent a web page instead of data');
    }
  }

  return {
    async getJson(path) {
      if (broken !== null) return invalid(broken);
      const turn: LimitedResult<SessionResponse> = await limiter.run(() => request(path));
      if (turn.status === 'paused') {
        return {
          ok: false,
          kind: 'rate_limited',
          message: 'Hourly request limit for the session reached',
          retryAfterS: Math.max(1, Math.ceil((turn.untilMs - clock.nowMs()) / 1000)),
        };
      }
      return turn.value;
    },
  };
}
