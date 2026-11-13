/**
 * Subreddit validation requested by the dashboard and carried out by the
 * worker. Only the worker reads Reddit, so all reads share one rate limit;
 * the dashboard leaves a request and shows the progress the worker writes.
 */
import type { Db } from './db/client';
import { validateSubreddits, type SubredditCheck } from './profile/subreddits';
import type { RedditSource } from './reddit/types';
import { clearState, readState, writeState, type StateValue } from './state';

export type ValidationProgress = StateValue<'state.validationProgress'>;

export function requestValidation(db: Db, names: string[], now: number): void {
  writeState(db, 'state.validationRequest', { requestedAt: now, names });
  writeState(db, 'state.validationProgress', {
    requestedAt: now,
    total: names.length,
    done: names.length === 0,
    results: [],
  });
}

export function validationProgress(db: Db): ValidationProgress | null {
  return readState(db, 'state.validationProgress');
}

export function hasValidationRequest(db: Db): boolean {
  return readState(db, 'state.validationRequest') !== null;
}

function toProgressResult(check: SubredditCheck): ValidationProgress['results'][number] {
  if (check.status === 'ok')
    return { name: check.name, status: 'ok', postsPerDay: check.postsPerDay };
  if (check.status === 'gone') return { name: check.name, status: 'gone' };
  return { name: check.name, status: 'unavailable', message: check.message };
}

/** Runs a pending request, recording results as each subreddit is checked. */
export async function runValidationRequest(
  db: Db,
  source: RedditSource,
  now: number,
): Promise<boolean> {
  const request = readState(db, 'state.validationRequest');
  if (!request) return false;
  clearState(db, 'state.validationRequest');
  const save = (results: ValidationProgress['results'], done: boolean) => {
    writeState(db, 'state.validationProgress', {
      requestedAt: request.requestedAt,
      total: request.names.length,
      done,
      results,
    });
  };
  const live: ValidationProgress['results'] = [];
  const checks = await validateSubreddits(source, request.names, now, (_done, _total, check) => {
    live.push(toProgressResult(check));
    save([...live], false);
  });
  // The final write also covers names skipped after Reddit paused reads.
  save(checks.map(toProgressResult), true);
  return true;
}
