import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
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
  it('checks the session, reads the account name and stores both', async () => {
    const db = openMemoryDatabase();
    const secrets = createTestSecrets(db);
    const reddit = client({
      '/r/popular.json': { ok: true, json: { kind: 'Listing', data: { children: [] } } },
      '/api/me.json': { ok: true, json: { name: 'demo_reader' } },
    });
    expect(await connectSession({ db, secrets, now: 100 }, COOKIE, reddit)).toEqual({
      ok: true,
      username: 'demo_reader',
    });
    expect(secrets.use('reddit_session_cookie')).toEqual({ ok: true, value: COOKIE });
    expect(sessionStatus(db, secrets)).toEqual({
      status: 'connected',
      username: 'demo_reader',
      connectedAt: 100,
    });
  });

  it('still connects when the account name cannot be read', async () => {
    const db = openMemoryDatabase();
    const secrets = createTestSecrets(db);
    const reddit = client({
      '/r/popular.json': { ok: true, json: { kind: 'Listing', data: { children: [] } } },
      '/api/me.json': { ok: false, kind: 'auth', message: 'blocked' },
    });
    expect(await connectSession({ db, secrets, now: 100 }, COOKIE, reddit)).toEqual({
      ok: true,
      username: null,
    });
  });

  it('saves nothing when Reddit refuses the session', async () => {
    const db = openMemoryDatabase();
    const secrets = createTestSecrets(db);
    const reddit = client({ '/r/popular.json': { ok: false, kind: 'auth', message: 'refused' } });
    const result = await connectSession({ db, secrets, now: 100 }, COOKIE, reddit);
    expect(result).toMatchObject({ ok: false });
    expect(sessionStatus(db, secrets)).toEqual({ status: 'not_connected' });
    expect(reddit.paths).toHaveLength(1);
  });

  it('remembers when the session needs reconnecting, and forgets everything on disconnect', async () => {
    const db = openMemoryDatabase();
    const secrets = createTestSecrets(db);
    const reddit = client({
      '/r/popular.json': { ok: true, json: { kind: 'Listing', data: { children: [] } } },
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
    disconnectSession(db, secrets);
    expect(sessionStatus(db, secrets)).toEqual({ status: 'not_connected' });
    expect(secrets.has('reddit_session_cookie')).toBe(false);
  });
});
