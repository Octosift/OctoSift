import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { openMemoryDatabase } from '../db/client';
import { silentLogger } from '../log';
import { readState } from '../state';
import { createFakeClock } from '../testing/fake-clock';
import { dismissUpdateNotice, runUpdateCheck, updateView } from './check';
import type { LatestRelease, ReleaseResult } from './github';

const LATEST: LatestRelease = {
  tag: 'v0.2.0',
  url: 'https://github.com/Octosift/OctoSift/releases/tag/v0.2.0',
  publishedAt: '2026-12-01T10:00:00Z',
  notes: '## Announcement\nThe extension is out: https://example.com/extension',
};
const RELEASE: ReleaseResult = { ok: true, release: LATEST };

function setup(results: ReleaseResult[] = [RELEASE]) {
  const db = openMemoryDatabase();
  const clock = createFakeClock();
  let calls = 0;
  const check = (options: { enabled?: boolean; currentVersion?: string } = {}) =>
    runUpdateCheck({
      db,
      clock,
      log: silentLogger(),
      enabled: options.enabled ?? true,
      currentVersion: options.currentVersion ?? '0.1.0',
      fetchLatest: () => {
        const result = results[Math.min(calls, results.length - 1)] ?? RELEASE;
        calls += 1;
        return Promise.resolve(result);
      },
    });
  return { db, clock, check, calls: () => calls };
}

const VIEW = { enabled: true, currentVersion: '0.1.0' };

describe('runUpdateCheck', () => {
  it('makes no request when turned off', async () => {
    const { db, check, calls } = setup();
    expect(await check({ enabled: false })).toBe('disabled');
    expect(calls()).toBe(0);
    expect(readState(db, 'state.updateCheck')).toBeNull();
  });

  it('checks at most once a day', async () => {
    const { clock, check, calls } = setup();
    expect(await check()).toBe('checked');
    clock.advance(CONFIG.updates.checkIntervalMs - 1);
    expect(await check()).toBe('not_due');
    clock.advance(1);
    expect(await check()).toBe('checked');
    expect(calls()).toBe(2);
  });

  it('stores the latest release with its announcement', async () => {
    const { db, clock, check } = setup();
    await check();
    expect(readState(db, 'state.updateCheck')).toEqual({
      checkedAt: clock.nowMs(),
      nextAt: clock.nowMs() + CONFIG.updates.checkIntervalMs,
      latest: {
        version: '0.2.0',
        url: 'https://github.com/Octosift/OctoSift/releases/tag/v0.2.0',
        publishedAt: '2026-12-01T10:00:00Z',
        announcement: {
          text: 'The extension is out: https://example.com/extension',
          url: 'https://example.com/extension',
        },
      },
      error: null,
    });
  });

  it('keeps the last good result after a failure and retries sooner', async () => {
    const { db, clock, check } = setup([RELEASE, { ok: false, message: 'offline' }]);
    await check();
    clock.advance(CONFIG.updates.checkIntervalMs);
    expect(await check()).toBe('failed');
    const state = readState(db, 'state.updateCheck');
    expect(state?.error).toBe('offline');
    expect(state?.latest?.version).toBe('0.2.0');
    expect(state?.nextAt).toBe(clock.nowMs() + CONFIG.updates.retryAfterErrorMs);
  });

  it('never throws, even when the fetcher does', async () => {
    const db = openMemoryDatabase();
    const outcome = await runUpdateCheck({
      db,
      clock: createFakeClock(),
      log: silentLogger(),
      enabled: true,
      currentVersion: '0.1.0',
      fetchLatest: () => Promise.reject(new Error('boom')),
    });
    expect(outcome).toBe('failed');
    expect(readState(db, 'state.updateCheck')?.error).toBe('boom');
  });

  it('stores nothing to show when no release exists or its tag is not a version', async () => {
    for (const result of [
      { ok: true, release: null },
      { ok: true, release: { ...LATEST, tag: 'nightly' } },
    ] as ReleaseResult[]) {
      const { db, check } = setup([result]);
      expect(await check()).toBe('checked');
      expect(readState(db, 'state.updateCheck')?.latest).toBeNull();
      expect(updateView(db, VIEW)).toEqual({ update: null, announcement: null });
    }
  });
});

describe('updateView', () => {
  it('shows a newer version and the announcement', async () => {
    const { db, check } = setup();
    await check();
    const view = updateView(db, VIEW);
    expect(view.update).toEqual({
      version: '0.2.0',
      url: 'https://github.com/Octosift/OctoSift/releases/tag/v0.2.0',
    });
    expect(view.announcement).toMatchObject({ url: 'https://example.com/extension' });
  });

  it('shows the announcement but no update when already on the latest version', async () => {
    const { db, check } = setup();
    await check();
    const view = updateView(db, { enabled: true, currentVersion: '0.2.0' });
    expect(view.update).toBeNull();
    expect(view.announcement).not.toBeNull();
  });

  it('shows nothing when the check is turned off', async () => {
    const { db, check } = setup();
    await check();
    expect(updateView(db, { ...VIEW, enabled: false })).toEqual({
      update: null,
      announcement: null,
    });
  });

  it('keeps a closed notice closed until a newer version or a new announcement', async () => {
    const newer: ReleaseResult = {
      ok: true,
      release: {
        tag: 'v0.3.0',
        url: 'https://github.com/Octosift/OctoSift/releases/tag/v0.3.0',
        publishedAt: null,
        notes: '## Announcement\nSomething else.',
      },
    };
    const { db, clock, check } = setup([RELEASE, newer]);
    await check();
    const first = updateView(db, VIEW);
    dismissUpdateNotice(db, { kind: 'update', version: '0.2.0' });
    if (first.announcement) {
      dismissUpdateNotice(db, { kind: 'announcement', key: first.announcement.key });
    }
    expect(updateView(db, VIEW)).toEqual({ update: null, announcement: null });

    clock.advance(CONFIG.updates.checkIntervalMs);
    await check();
    const next = updateView(db, VIEW);
    expect(next.update?.version).toBe('0.3.0');
    expect(next.announcement?.text).toBe('Something else.');
  });
});
