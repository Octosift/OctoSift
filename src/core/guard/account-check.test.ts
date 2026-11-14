import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { silentLogger } from '../log';
import type { SessionResponse } from '../reddit/session-client';
import { readState, writeState } from '../state';
import { accountProblem, parseAbout, runAccountCheck } from './account-check';

const NOW = 1_800_000_000;
const DAY = 86_400;
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/session', name), 'utf8'));

const VISIBLE: SessionResponse = { ok: true, json: fixture('user-about.json') };
const SUSPENDED: SessionResponse = { ok: true, json: fixture('user-about-suspended.json') };
const NOT_FOUND: SessionResponse = { ok: false, kind: 'gone', status: 404, message: 'Not found' };

/** A fake session client that hands out the given answers in order. */
function reddit(...answers: SessionResponse[]) {
  const paths: string[] = [];
  return {
    paths,
    getJson: (path: string): Promise<SessionResponse> => {
      paths.push(path);
      return Promise.resolve(
        answers.shift() ?? { ok: false, kind: 'network', message: 'no answer left' },
      );
    },
  };
}

function check(db: ReturnType<typeof openMemoryDatabase>, client: ReturnType<typeof reddit>) {
  return (now: number, username: string | null = 'demo_reader') =>
    runAccountCheck({ db, reddit: client, username, now, log: silentLogger() });
}

describe('profile answers', () => {
  it('reads a visible and a suspended profile, and refuses anything else', () => {
    expect(parseAbout(fixture('user-about.json'))).toBe('visible');
    expect(parseAbout(fixture('user-about-suspended.json'))).toBe('suspended');
    expect(parseAbout({ kind: 'Listing' })).toBeNull();
  });
});

describe('account check', () => {
  it('reads the profile once a day', async () => {
    const db = openMemoryDatabase();
    const client = reddit(VISIBLE, VISIBLE);
    const run = check(db, client);
    expect(await run(NOW)).toBe('visible');
    expect(client.paths).toEqual(['/user/demo_reader/about.json?raw_json=1']);
    expect(await run(NOW + DAY - 60)).toBeNull();
    expect(client.paths).toHaveLength(1);
    expect(await run(NOW + DAY)).toBe('visible');
    expect(client.paths).toHaveLength(2);
    expect(accountProblem(db, 'demo_reader')).toBeNull();
  });

  it('checks a suspension again after half an hour before reporting it', async () => {
    const db = openMemoryDatabase();
    const run = check(db, reddit(SUSPENDED, SUSPENDED));
    expect(await run(NOW)).toBe('suspended');
    expect(readState(db, 'state.accountCheck')).toMatchObject({
      confirmed: false,
      nextAt: NOW + 1800,
    });
    expect(accountProblem(db, 'demo_reader')).toBeNull();
    expect(await run(NOW + 1000)).toBeNull();
    expect(await run(NOW + 1800)).toBe('suspended');
    expect(readState(db, 'state.accountCheck')).toMatchObject({
      confirmed: true,
      nextAt: NOW + 1800 + DAY,
    });
    expect(accountProblem(db, 'demo_reader')).toEqual({
      username: 'demo_reader',
      status: 'suspended',
    });
  });

  it('treats a missing profile as hidden, and forgets it when the recheck finds it', async () => {
    const db = openMemoryDatabase();
    const run = check(db, reddit(NOT_FOUND, VISIBLE));
    expect(await run(NOW)).toBe('missing');
    expect(await run(NOW + 1800)).toBe('visible');
    expect(readState(db, 'state.accountCheck')).toMatchObject({
      status: 'visible',
      confirmed: false,
    });
    expect(accountProblem(db, 'demo_reader')).toBeNull();
  });

  it('reads the account name first when it is not known yet', async () => {
    const db = openMemoryDatabase();
    writeState(db, 'state.redditSession', {
      status: 'connected',
      username: null,
      at: NOW - DAY,
      reason: null,
    });
    const client = reddit({ ok: true, json: { name: 'demo_reader' } }, VISIBLE);
    expect(await check(db, client)(NOW, null)).toBe('visible');
    expect(client.paths).toEqual([
      '/api/me.json?raw_json=1',
      '/user/demo_reader/about.json?raw_json=1',
    ]);
    expect(readState(db, 'state.redditSession')?.username).toBe('demo_reader');
  });

  it('tries again half an hour later when the profile could not be read', async () => {
    const db = openMemoryDatabase();
    const client = reddit({ ok: false, kind: 'network', message: 'Could not reach Reddit' });
    expect(await check(db, client)(NOW)).toBeNull();
    expect(readState(db, 'state.accountCheck')).toMatchObject({
      status: null,
      nextAt: NOW + 1800,
    });
  });

  it('leaves the timing to the session after a refusal or at the hourly cap', async () => {
    const db = openMemoryDatabase();
    for (const answer of [
      { ok: false, kind: 'auth', message: 'Reddit refused the session (HTTP 401)' },
      { ok: false, kind: 'rate_limited', message: 'Hourly request limit reached' },
    ] as const) {
      expect(await check(db, reddit(answer))(NOW)).toBeNull();
    }
    expect(readState(db, 'state.accountCheck')).toBeNull();
  });

  it('ignores a result about an account connected before', async () => {
    const db = openMemoryDatabase();
    await check(db, reddit(SUSPENDED, SUSPENDED))(NOW, 'old_reader');
    await check(db, reddit(SUSPENDED))(NOW + 1800, 'old_reader');
    expect(accountProblem(db, 'old_reader')).not.toBeNull();
    expect(accountProblem(db, 'demo_reader')).toBeNull();
    const client = reddit(VISIBLE);
    expect(await check(db, client)(NOW + 1900, 'demo_reader')).toBe('visible');
    expect(client.paths).toHaveLength(1);
  });
});
