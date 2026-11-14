import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { suggestOnce } from './suggestion-cache';
import type { SuggestResult } from './subreddits';

const ANSWER: SuggestResult = {
  ok: true,
  suggestions: [
    { name: 'freelance_demo', reason: 'Freelancers ask here', promotionStrictness: 'moderate' },
  ],
};

describe('subreddit suggestion cache', () => {
  it('shares a call in flight and keeps the answer for the same profile', async () => {
    const db = openMemoryDatabase();
    let calls = 0;
    const ask = () => {
      calls += 1;
      return new Promise<SuggestResult>((resolve) => setTimeout(() => resolve(ANSWER), 5));
    };
    const product = { id: 'p1', updatedAt: 100 };
    const [first, second] = await Promise.all([
      suggestOnce(db, product, ask),
      suggestOnce(db, product, ask),
    ]);
    expect(first).toEqual(ANSWER);
    expect(second).toEqual(ANSWER);
    expect(await suggestOnce(db, product, ask)).toEqual(ANSWER);
    expect(calls).toBe(1);
  });

  it('asks again when the profile changed, and does not keep failures', async () => {
    const db = openMemoryDatabase();
    let calls = 0;
    const fail = (): Promise<SuggestResult> => {
      calls += 1;
      return Promise.resolve({ ok: false, message: 'The model did not answer' });
    };
    await suggestOnce(db, { id: 'p1', updatedAt: 100 }, fail);
    await suggestOnce(db, { id: 'p1', updatedAt: 100 }, fail);
    expect(calls).toBe(2);
    await suggestOnce(db, { id: 'p1', updatedAt: 100 }, () => Promise.resolve(ANSWER));
    let asked = false;
    await suggestOnce(db, { id: 'p1', updatedAt: 200 }, () => {
      asked = true;
      return Promise.resolve(ANSWER);
    });
    expect(asked).toBe(true);
  });
});
