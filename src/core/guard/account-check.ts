/**
 * A daily look at the connected account's public profile, read with the
 * session. Reddit marks suspended accounts as such and answers "not found"
 * for accounts that are shadowbanned or deleted. One bad answer can be a
 * glitch, so a bad result is checked again half an hour later and only a
 * repeat is reported.
 *
 * Like the reply checks, these reads share the session's pacing and hourly
 * cap, and only a refusal or a sign-in redirect marks the session.
 */
import { z } from 'zod';
import { CONFIG } from '../config';
import type { Db } from '../db/client';
import type { Logger } from '../log';
import { readAccountName, setSessionUsername } from '../reddit/account';
import type { SessionClient } from '../reddit/session-client';
import { readState, writeState, type StateValue } from '../state';

export type ProfileStatus = 'visible' | 'suspended' | 'missing';
export type AccountCheckState = StateValue<'state.accountCheck'>;

const about = z.object({
  data: z.object({ name: z.string(), is_suspended: z.boolean().optional() }),
});

/** Reads a profile answer; null when it is not one. */
export function parseAbout(json: unknown): Exclude<ProfileStatus, 'missing'> | null {
  const parsed = about.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data.data.is_suspended === true ? 'suspended' : 'visible';
}

const sameName = (a: string | null | undefined, b: string | null) =>
  typeof a === 'string' && b !== null && a.toLowerCase() === b.toLowerCase();

/**
 * Runs the check when it is due. `username` is the connected account's name
 * when known; otherwise it is read from /api/me.json first. Returns the status
 * it found, or null when nothing was due or the check could not run.
 */
export async function runAccountCheck(deps: {
  db: Db;
  reddit: Pick<SessionClient, 'getJson'>;
  username: string | null;
  now: number;
  log: Logger;
}): Promise<ProfileStatus | null> {
  const { db, now, log } = deps;
  const { profileCheckIntervalS, profileRecheckAfterS, retryAfterS } = CONFIG.visibility;
  const stored = readState(db, 'state.accountCheck');
  // A result about another account (one connected before) does not count.
  const previous =
    deps.username === null || sameName(stored?.username, deps.username) ? stored : null;
  if (previous && previous.nextAt > now) return null;

  let username = deps.username;
  if (username === null) {
    const me = await readAccountName(deps.reddit);
    if (!me.ok) {
      log.warn('Account check could not read the account name', { reason: me.message });
      if (me.kind !== 'auth' && me.kind !== 'rate_limited') {
        writeState(db, 'state.accountCheck', {
          username: null,
          status: null,
          confirmed: false,
          checkedAt: now,
          nextAt: now + retryAfterS,
        });
      }
      return null;
    }
    username = me.username;
    setSessionUsername(db, username);
  }

  const answer = await deps.reddit.getJson(
    `/user/${encodeURIComponent(username)}/about.json?raw_json=1`,
  );
  let status: ProfileStatus | null = null;
  if (answer.ok) {
    status = parseAbout(answer.json);
  } else if (answer.kind === 'gone' && answer.status === 404) {
    status = 'missing';
  } else if (
    answer.kind === 'auth' ||
    answer.kind === 'rate_limited' ||
    answer.kind === 'blocked'
  ) {
    // Reconnecting, or the hourly allowance, decides when to try again.
    return null;
  }
  if (status === null) {
    log.warn('Account check could not run', {
      reason: answer.ok ? 'Not a profile' : answer.message,
    });
    writeState(db, 'state.accountCheck', {
      username,
      status: previous?.status ?? null,
      confirmed: previous?.confirmed ?? false,
      checkedAt: now,
      nextAt: now + retryAfterS,
    });
    return null;
  }

  const bad = status !== 'visible';
  const repeat = bad && (previous?.status === 'suspended' || previous?.status === 'missing');
  writeState(db, 'state.accountCheck', {
    username,
    status,
    confirmed: repeat,
    checkedAt: now,
    nextAt: now + (bad && !repeat ? profileRecheckAfterS : profileCheckIntervalS),
  });
  if (bad) log.warn('Connected account looks hidden', { status, confirmed: repeat });
  return status;
}

/** A confirmed problem with the connected account, for the dashboard. */
export function accountProblem(
  db: Db,
  username: string | null,
): { username: string; status: Exclude<ProfileStatus, 'visible'> } | null {
  const state = readState(db, 'state.accountCheck');
  if (!state?.confirmed || state.username === null) return null;
  if (username !== null && !sameName(state.username, username)) return null;
  return state.status === 'suspended' || state.status === 'missing'
    ? { username: state.username, status: state.status }
    : null;
}
