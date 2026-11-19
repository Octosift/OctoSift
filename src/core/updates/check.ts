/**
 * The daily check for a new release, run by the worker, and what Home shows
 * from its result.
 *
 * The check never throws: a failure is stored with the time of the next try,
 * and the last good result is kept so a network hiccup does not hide a
 * notice the user has not seen yet.
 */
import type { Clock } from '../clock';
import { CONFIG } from '../config';
import type { Db } from '../db/client';
import type { Logger } from '../log';
import { readState, writeState, type StateValue } from '../state';
import type { ReleaseResult } from './github';
import {
  announcementKey,
  formatVersion,
  isNewer,
  parseAnnouncement,
  parseVersion,
  type Announcement,
} from './release';

export interface UpdateCheckDeps {
  db: Db;
  clock: Clock;
  log: Logger;
  /** False when the user turned the check off, or in demo mode. */
  enabled: boolean;
  currentVersion: string;
  fetchLatest: () => Promise<ReleaseResult>;
}

export type UpdateCheckOutcome = 'disabled' | 'not_due' | 'checked' | 'failed';

type Latest = NonNullable<StateValue<'state.updateCheck'>['latest']>;

export async function runUpdateCheck(deps: UpdateCheckDeps): Promise<UpdateCheckOutcome> {
  const { db, clock, log } = deps;
  if (!deps.enabled) return 'disabled';
  const previous = readState(db, 'state.updateCheck');
  const now = clock.nowMs();
  if (previous && now < previous.nextAt) return 'not_due';

  let result: ReleaseResult;
  try {
    result = await deps.fetchLatest();
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : 'Unknown error' };
  }

  if (!result.ok) {
    writeState(db, 'state.updateCheck', {
      checkedAt: now,
      nextAt: now + CONFIG.updates.retryAfterErrorMs,
      latest: previous?.latest ?? null,
      error: result.message,
    });
    log.warn('Update check failed', { reason: result.message });
    return 'failed';
  }

  const version = result.release ? parseVersion(result.release.tag) : null;
  const latest: Latest | null =
    result.release && version
      ? {
          version: formatVersion(version),
          url: result.release.url,
          publishedAt: result.release.publishedAt,
          announcement: parseAnnouncement(result.release.notes),
        }
      : null;
  writeState(db, 'state.updateCheck', {
    checkedAt: now,
    nextAt: now + CONFIG.updates.checkIntervalMs,
    latest,
    error: null,
  });
  if (latest && isNewer(latest.version, deps.currentVersion)) {
    log.info('A new version is available', { version: latest.version });
  }
  return 'checked';
}

export interface UpdateView {
  /** A newer release than the one running, unless the user closed its notice. */
  update: { version: string; url: string } | null;
  /** The latest release's announcement, unless the user closed it. */
  announcement: (Announcement & { key: string }) | null;
}

export function updateView(
  db: Db,
  options: { enabled: boolean; currentVersion: string },
): UpdateView {
  const none: UpdateView = { update: null, announcement: null };
  if (!options.enabled) return none;
  const latest = readState(db, 'state.updateCheck')?.latest ?? null;
  if (!latest) return none;
  const dismissed = readState(db, 'state.updateDismissed');

  const update =
    isNewer(latest.version, options.currentVersion) && dismissed?.version !== latest.version
      ? { version: latest.version, url: latest.url }
      : null;
  const key = latest.announcement ? announcementKey(latest.announcement) : null;
  const announcement =
    latest.announcement && key !== null && dismissed?.announcement !== key
      ? { ...latest.announcement, key }
      : null;
  return { update, announcement };
}

/** Hides the update notice for one version, or one announcement, until something newer comes. */
export function dismissUpdateNotice(
  db: Db,
  notice: { kind: 'update'; version: string } | { kind: 'announcement'; key: string },
): void {
  const current = readState(db, 'state.updateDismissed') ?? { version: null, announcement: null };
  writeState(
    db,
    'state.updateDismissed',
    notice.kind === 'update'
      ? { ...current, version: notice.version }
      : { ...current, announcement: notice.key },
  );
}

/** The last check, for the Settings page. */
export function lastUpdateCheck(db: Db) {
  return readState(db, 'state.updateCheck');
}
