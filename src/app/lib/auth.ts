/**
 * The optional password gate. When APP_PASSWORD is set, every page needs a
 * session cookie whose value is an HMAC of the password, so changing the
 * password signs everyone out. Comparisons are constant-time.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'dashboard_session';

export function sessionToken(password: string): string {
  return createHmac('sha256', password).update('dashboard-session-v1').digest('hex');
}

function sameText(a: string, b: string): boolean {
  // Hashing first gives equal-length buffers, as timingSafeEqual requires.
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

export function isValidSession(password: string, token: string | undefined): boolean {
  return token !== undefined && sameText(sessionToken(password), token);
}

export function passwordMatches(expected: string, given: string): boolean {
  return sameText(expected, given);
}

/** Only same-site paths are allowed as a destination after signing in. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw?.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}
