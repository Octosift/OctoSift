/**
 * The optional password gate. When APP_PASSWORD is set, every page needs a
 * session cookie. The cookie holds the time it was issued and an HMAC of that
 * time, keyed by a slow hash of the password. Sessions therefore expire,
 * changing the password signs everyone out, and a copied cookie is costly to
 * turn back into the password. Comparisons are constant-time.
 */
import { createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'dashboard_session';
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

let cachedKey: { password: string; key: Buffer } | null = null;

/** The slow hash runs once per process, so checking a cookie on each request stays cheap. */
function sessionKey(password: string): Buffer {
  if (cachedKey?.password !== password) {
    cachedKey = { password, key: scryptSync(password, 'dashboard-session-v2', 32) };
  }
  return cachedKey.key;
}

export function sessionToken(password: string, issuedAtS: number): string {
  const mac = createHmac('sha256', sessionKey(password))
    .update(`session:${String(issuedAtS)}`)
    .digest('hex');
  return `${String(issuedAtS)}.${mac}`;
}

function sameText(a: string, b: string): boolean {
  // Hashing first gives equal-length buffers, as timingSafeEqual requires.
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

export function isValidSession(password: string, token: string | undefined, nowS: number): boolean {
  const issued = token?.match(/^(\d{1,12})\.[0-9a-f]{64}$/)?.[1];
  if (token === undefined || issued === undefined) return false;
  const issuedAtS = Number(issued);
  // Allow a minute of clock difference; refuse tokens from the future or past their age.
  if (issuedAtS > nowS + 60 || nowS - issuedAtS > SESSION_MAX_AGE_S) return false;
  return sameText(sessionToken(password, issuedAtS), token);
}

export function passwordMatches(expected: string, given: string): boolean {
  return sameText(expected, given);
}

/** Only same-site paths are allowed as a destination after signing in. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw?.startsWith('/') || raw.startsWith('//')) return '/';
  // Browsers drop tabs and line breaks from URLs and read a backslash as a
  // slash, so "/<tab>/host" or "/\host" would leave the site.
  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === '\\') return '/';
  }
  return raw;
}

/**
 * Counts wrong passwords from all clients together. Once there are too many
 * within the window, sign-ins pause until older failures age out.
 */
export function createLoginThrottle(limit: { maxFailures: number; windowMs: number }) {
  let failures: number[] = [];
  const recent = (nowMs: number) => {
    failures = failures.filter((at) => at > nowMs - limit.windowMs);
    return failures;
  };
  return {
    blocked: (nowMs: number): boolean => recent(nowMs).length >= limit.maxFailures,
    fail: (nowMs: number): void => {
      recent(nowMs).push(nowMs);
    },
  };
}
