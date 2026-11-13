import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from './db/client';
import type { FetchResult, RedditSource } from './reddit/types';
import {
  hasValidationRequest,
  requestValidation,
  runValidationRequest,
  validationProgress,
} from './validation-queue';

const rate = { used: 1, remaining: 1, resetS: 1 };

function source(results: Record<string, FetchResult>): RedditSource {
  return {
    fetchNewPosts: (names) =>
      Promise.resolve(results[names[0] ?? ''] ?? { ok: false, kind: 'gone' }),
  };
}

describe('validation queue', () => {
  it('records a request and reports it as pending with no results', () => {
    const db = openMemoryDatabase();
    requestValidation(db, ['a_demo', 'b_demo'], 100);
    expect(hasValidationRequest(db)).toBe(true);
    expect(validationProgress(db)).toEqual({
      requestedAt: 100,
      total: 2,
      done: false,
      results: [],
    });
  });

  it('checks each subreddit and stores the outcome', async () => {
    const db = openMemoryDatabase();
    requestValidation(db, ['a_demo', 'missing_demo'], 100);
    const ran = await runValidationRequest(
      db,
      source({ a_demo: { ok: true, posts: [], rate } }),
      1_000,
    );
    expect(ran).toBe(true);
    expect(hasValidationRequest(db)).toBe(false);
    expect(validationProgress(db)).toEqual({
      requestedAt: 100,
      total: 2,
      done: true,
      results: [
        { name: 'a_demo', status: 'ok', postsPerDay: 0 },
        { name: 'missing_demo', status: 'gone' },
      ],
    });
  });

  it('marks the remaining subreddits unavailable when Reddit pauses reads', async () => {
    const db = openMemoryDatabase();
    requestValidation(db, ['a_demo', 'b_demo'], 100);
    await runValidationRequest(
      db,
      source({ a_demo: { ok: false, kind: 'blocked', retryAfterS: 600, message: 'paused' } }),
      1_000,
    );
    expect(validationProgress(db)?.results.map((result) => result.status)).toEqual([
      'unavailable',
      'unavailable',
    ]);
  });

  it('does nothing without a request', async () => {
    const db = openMemoryDatabase();
    expect(await runValidationRequest(db, source({}), 1_000)).toBe(false);
  });
});
