/**
 * The connected Reddit account behind the session source: storing and
 * checking its cookie, remembering whose it is, and noticing when it needs
 * to be reconnected. The cookie itself lives in the encrypted secret store.
 */
import { z } from 'zod';
import type { Db } from '../db/client';
import type { SecretStore } from '../secrets/store';
import { clearState, readState, writeState } from '../state';
import type { SessionClient } from './session-client';

export type SessionStatus =
  | { status: 'not_connected' }
  | { status: 'connected'; username: string | null; connectedAt: number }
  | { status: 'needs_reauth'; username: string | null; reason: string; since: number };

export function sessionStatus(db: Db, secrets: SecretStore): SessionStatus {
  const state = readState(db, 'state.redditSession');
  if (!secrets.describe('reddit_session_cookie').configured) return { status: 'not_connected' };
  if (state?.status === 'needs_reauth') {
    return {
      status: 'needs_reauth',
      username: state.username,
      reason: state.reason ?? 'Reddit stopped accepting the session',
      since: state.at,
    };
  }
  return { status: 'connected', username: state?.username ?? null, connectedAt: state?.at ?? 0 };
}

/** Accepts a pasted Cookie header, with or without the "cookie:" prefix and line breaks. */
export function normalizeCookieHeader(raw: string): string | null {
  const header = raw
    .replace(/^\s*cookie\s*:/i, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  const pairs = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^[^=\s]+=.*/.test(part));
  if (!pairs.some((pair) => pair.startsWith('reddit_session='))) return null;
  return pairs.join('; ');
}

const meSchema = z
  .object({ name: z.string().min(1) })
  .or(z.object({ data: z.object({ name: z.string().min(1) }) }));

export type ConnectResult = { ok: true; username: string | null } | { ok: false; message: string };

/**
 * Checks a cookie with one listing request, reads the account name when Reddit
 * allows it, and stores both. Nothing is saved when the check fails.
 */
export async function connectSession(
  deps: { db: Db; secrets: SecretStore; now: number },
  cookie: string,
  client: SessionClient,
): Promise<ConnectResult> {
  const check = await client.getJson('/r/popular.json?limit=1&raw_json=1');
  if (!check.ok) {
    return {
      ok: false,
      message:
        check.kind === 'auth'
          ? 'Reddit did not accept this session. Sign in again and copy a fresh cookie.'
          : `Could not check the session: ${check.message}`,
    };
  }
  const me = await client.getJson('/api/me.json?raw_json=1');
  const parsed = me.ok ? meSchema.safeParse(me.json) : null;
  const username = parsed?.success
    ? 'name' in parsed.data
      ? parsed.data.name
      : parsed.data.data.name
    : null;
  deps.secrets.set('reddit_session_cookie', cookie);
  writeState(deps.db, 'state.redditSession', {
    status: 'connected',
    username,
    at: deps.now,
    reason: null,
  });
  return { ok: true, username };
}

export function setSessionUsername(db: Db, username: string): void {
  const state = readState(db, 'state.redditSession');
  if (state) writeState(db, 'state.redditSession', { ...state, username });
}

export function markSessionNeedsReauth(db: Db, reason: string, now: number): void {
  const state = readState(db, 'state.redditSession');
  writeState(db, 'state.redditSession', {
    status: 'needs_reauth',
    username: state?.username ?? null,
    at: now,
    reason,
  });
}

export function disconnectSession(db: Db, secrets: SecretStore): void {
  secrets.remove('reddit_session_cookie');
  clearState(db, 'state.redditSession');
}
