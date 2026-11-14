import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { readState, writeState } from '../state';
import { createTestSecrets } from '../testing/fake-secrets';
import {
  connectSession,
  disconnectSession,
  markSessionNeedsReauth,
  normalizeCookieHeader,
  sessionStatus,
} from './account';
import type { SessionClient, SessionResponse } from './session-client';

const COOKIE = 'reddit_session=synthetic-session-value; token_v2=synthetic-token';

function client(answers: Record<string, SessionResponse>): SessionClient & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    getJson: (path) => {
      paths.push(path);
      const match = Object.entries(answers).find(([prefix]) => path.startsWith(prefix));
      return Promise.resolve(match ? match[1] : { ok: false, kind: 'gone', message: 'x' });
    },
  };
}

describe('normalizeCookieHeader', () => {
  it('accepts a pasted header with or without its name and line breaks', () => {
    expect(normalizeCookieHeader(`cookie: ${COOKIE}`)).toBe(COOKIE);
    expect(normalizeCookieHeader(`  reddit_session=abc;\n  token_v2=def ; `)).toBe(
      'reddit_session=abc; token_v2=def',
    );
  });

  it('refuses text without a signed-in session', () => {
    expect(normalizeCookieHeader('token_v2=def; loid=x')).toBeNull();
    expect(normalizeCookieHeader('not a cookie')).toBeNull();
  });
});

describe('connecting an account', () => {
  it('checks the session with one request that also names the account, and stores both', async () => {
    const db = openMemoryDatabase();
    const secrets = createTestSecrets(db);
    const reddit = client({ '/api/me.json': { ok: true, json: { name: 'demo_reader' } } });
    expect(await connectSession({ db, secrets, now: 100 }, COOKIE, reddit)).toEqual({
      ok: true,
      username: 'demo_reader',
    });
    expect(reddit.paths).toEqual(['/api/me.json?raw_json=1']);
    expect(secrets.use('reddit_session_cookie')).toEqual({ ok: true, value: COOKIE });
    expect(sessionStatus(db, secrets)).toEqual({
      status: 'connected',
      username: 'demo_reader',
      connectedAt: 100,
    });
  });

  it.each([
    ['a refusal', { ok: false, kind: 'auth', message: 'refused' } as const],
    ['a session that is not signed in', { ok: true, json: {} } as const],
  ])('saves nothing after %s', async (_, answer) => {
    const db = openMemoryDatabase();
    const secrets = createTestSecrets(db);
    const reddit = client({ '/api/me.json': answer });
    expect(await connectSession({ db, secrets, now: 100 }, COOKIE, reddit)).toEqual({
      ok: false,
      message: 'Reddit did not accept this session. Sign in again and copy a fresh cookie.',
    });
    expect(sessionStatus(db, secrets)).toEqual({ status: 'not_connected' });
    expect(reddit.paths).toHaveLength(1);
  });

  it('says when the check itself could not run', async () => {
    const db = openMemoryDatabase();
    const secrets = createTestSecrets(db);
    const reddit = client({
      '/api/me.json': { ok: false, kind: 'network', message: 'Could not reach Reddit' },
    });
    expect(await connectSession({ db, secrets, now: 100 }, COOKIE, reddit)).toEqual({
      ok: false,
      message: 'Could not check the session: Could not reach Reddit',
    });
  });

  it('remembers when the session needs reconnecting, and forgets everything on disconnect', async () => {
    const db = openMemoryDatabase();
    const secrets = createTestSecrets(db);
    const reddit = client({
      '/api/me.json': { ok: true, json: { data: { name: 'demo_reader' } } },
    });
    await connectSession({ db, secrets, now: 100 }, COOKIE, reddit);
    markSessionNeedsReauth(db, 'Reddit asked to sign in again', 200);
    expect(sessionStatus(db, secrets)).toEqual({
      status: 'needs_reauth',
      username: 'demo_reader',
      reason: 'Reddit asked to sign in again',
      since: 200,
    });
    writeState(db, 'state.accountCheck', {
      username: 'demo_reader',
      status: 'visible',
      confirmed: false,
      checkedAt: 200,
      nextAt: 300,
    });
    disconnectSession(db, secrets);
    expect(sessionStatus(db, secrets)).toEqual({ status: 'not_connected' });
    expect(readState(db, 'state.accountCheck')).toBeNull();
    expect(secrets.has('reddit_session_cookie')).toBe(false);
  });
});
