/**
 * HTTP access to Reddit's JSON listings with the user's own signed-in session.
 *
 * The Cookie header is a secret: it is sent only to www.reddit.com, never
 * logged, and passed in for every request rather than kept here. Requests go
 * one at a time through the session's own limiter. A 401 or 403, a redirect
 * to the login page or (for listing reads) a body that is not JSON means the
 * session no longer works: the client reports it once and makes no further
 * requests. A 403 that names a private or banned subreddit is about that
 * subreddit, not the session. A page that says Reddit blocked the network is
 * about the address the app runs from, not the session: reconnecting would not
 * help, so it is reported as `blocked` and leaves the session alone.
 */
import type { Clock } from '../clock';
import { CONFIG } from '../config';
import type { LimitedResult, RateLimiter } from './ratelimit';

export const SESSION_ORIGIN = 'https://www.reddit.com';

export type SessionFailureKind = 'auth' | 'gone' | 'rate_limited' | 'network' | 'blocked';

export type SessionResponse =
  | { ok: true; json: unknown }
  | {
      ok: false;
      kind: SessionFailureKind;
      message: string;
      retryAfterS?: number;
      /** The HTTP status, when Reddit answered with one. */
      status?: number;
    };

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
  /**
   * Whether a web page instead of JSON means the session stopped working. True
   * for listing reads; checks of single threads and profiles pass false, so only
   * a refusal or a sign-in redirect marks the session.
   */
  webPageMeansSignedOut?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function invalid(message: string): SessionResponse {
  return { ok: false, kind: 'auth', message };
}

/** Reasons Reddit gives in a 403 for a subreddit the account may not see. */
const COMMUNITY_REFUSALS = new Set(['private', 'banned', 'quarantined', 'gold_only', 'gated']);

const BLOCKED_MESSAGE =
  'Reddit is blocking requests from this network. Reconnecting will not help: run the app from another network or choose another data source in Settings.';

function hasBlockMarker(body: string): boolean {
  const lower = body.toLowerCase();
  return CONFIG.reddit.blockMarkers.some((marker) => lower.includes(marker));
}

/** The subreddit-level reason of a 403, or null when the refusal is about the session. */
function communityRefusal(text: string): string | null {
  try {
    const body = JSON.parse(text) as unknown;
    const reason =
      typeof body === 'object' && body !== null && 'reason' in body ? body.reason : null;
    return typeof reason === 'string' && COMMUNITY_REFUSALS.has(reason) ? reason : null;
  } catch {
    // Not JSON: a web page, which is about the session or the network.
    return null;
  }
}

export function createSessionClient(options: SessionClientOptions): SessionClient {
  const { limiter, clock, onInvalid, fetchImpl = fetch, webPageMeansSignedOut = true } = options;
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
      return { ok: false, kind: 'gone', status, message: `Redirected (HTTP ${String(status)})` };
    }
    if (status === 403) {
      const text = await response.text();
      if (hasBlockMarker(text)) {
        return { ok: false, kind: 'blocked', status, message: BLOCKED_MESSAGE };
      }
      const reason = communityRefusal(text);
      if (reason) {
        return { ok: false, kind: 'gone', status, message: `The subreddit is ${reason}` };
      }
      return markBroken('Reddit refused the session (HTTP 403)');
    }
    if (status === 401) {
      await response.body?.cancel();
      return markBroken('Reddit refused the session (HTTP 401)');
    }
    if (status === 404) {
      await response.body?.cancel();
      return { ok: false, kind: 'gone', status, message: 'Not found' };
    }
    if (status === 429) {
      await response.body?.cancel();
      const retry = Number(response.headers.get('retry-after'));
      return {
        ok: false,
        kind: 'rate_limited',
        message: 'Reddit asked to slow down',
        status,
        ...(Number.isFinite(retry) && retry > 0 ? { retryAfterS: retry } : {}),
      };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return {
        ok: false,
        kind: 'network',
        status,
        message: `Reddit answered HTTP ${String(status)}`,
      };
    }
    const text = await response.text();
    try {
      return { ok: true, json: JSON.parse(text) as unknown };
    } catch {
      // An HTML block or sign-in page instead of JSON.
      if (hasBlockMarker(text)) {
        return { ok: false, kind: 'blocked', status, message: BLOCKED_MESSAGE };
      }
      const message = 'Reddit sent a web page instead of data';
      return webPageMeansSignedOut
        ? markBroken(message)
        : { ok: false, kind: 'network', status, message };
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
