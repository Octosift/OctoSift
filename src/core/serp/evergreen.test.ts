import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { insertProduct } from '../db/queries/products';
import { recentSerpRuns, threadsForRun } from '../db/queries/serp';
import { loadSampleProduct } from '../demo/sample-products';
import { silentLogger } from '../log';
import type { SerpItem, SerpResponse } from './dataforseo';
import {
  cleanThreadTitle,
  evergreenDue,
  evergreenKeywords,
  redditThread,
  runEvergreenCheck,
} from './evergreen';

const NOW = 1_800_000_000;
const DAY = 86_400;

function setup() {
  const db = openMemoryDatabase();
  insertProduct(db, { id: 'p1', profile: loadSampleProduct('acme-invoices'), now: NOW - DAY });
  return db;
}

const item = (rank: number, url: string, extra: Partial<SerpItem> = {}): SerpItem => ({
  rank,
  url,
  title: `Result ${String(rank)} : r/freelance_demo`,
  publishedAt: NOW - 30 * DAY,
  ...extra,
});

function fetcher(answers: Record<string, SerpResponse>) {
  const asked: string[] = [];
  return {
    asked,
    fetchSerp: (keyword: string) => {
      asked.push(keyword);
      return Promise.resolve(answers[keyword] ?? { ok: true as const, items: [], costUsd: 0.004 });
    },
  };
}

describe('redditThread', () => {
  it('recognises thread links and normalises them', () => {
    expect(
      redditThread('https://old.reddit.com/r/Freelance_Demo/comments/AbC123/best_app/?utm=x'),
    ).toEqual({
      url: 'https://www.reddit.com/r/freelance_demo/comments/abc123/best_app/',
      postId: 't3_abc123',
      subreddit: 'freelance_demo',
    });
    expect(redditThread('https://www.reddit.com/r/freelance_demo/comments/abc123')?.url).toBe(
      'https://www.reddit.com/r/freelance_demo/comments/abc123/',
    );
  });

  it.each([
    'https://www.reddit.com/r/freelance_demo/',
    'https://www.reddit.com/user/someone/comments/abc123/x/',
    'https://notreddit.com/r/freelance_demo/comments/abc123/x/',
    'https://example.com/blog/best-invoicing-apps',
    'not a url',
  ])('ignores %s', (url) => {
    expect(redditThread(url)).toBeNull();
  });
});

describe('keywords and titles', () => {
  it('uses saved keywords, or else the buyer phrases, without duplicates and at most 20', () => {
    expect(evergreenKeywords(['  Invoice   app ', 'invoice app', 'x'], ['ignored'])).toEqual([
      'Invoice app',
    ]);
    const many = Array.from({ length: 30 }, (_, index) => `phrase ${String(index)}`);
    expect(evergreenKeywords([], many)).toHaveLength(20);
  });

  it('strips the subreddit and site suffixes Google adds to titles', () => {
    expect(cleanThreadTitle('Best invoicing app? : r/freelance_demo')).toBe('Best invoicing app?');
    expect(cleanThreadTitle('Best invoicing app? - Reddit')).toBe('Best invoicing app?');
    expect(cleanThreadTitle('Plain title')).toBe('Plain title');
  });
});

describe('runEvergreenCheck', () => {
  it('stores the Reddit threads per keyword with rank, age and the reported cost', async () => {
    const db = setup();
    const { fetchSerp } = fetcher({
      'invoice app': {
        ok: true,
        costUsd: 0.004,
        items: [
          item(1, 'https://example.com/top-10-invoice-apps'),
          item(2, 'https://www.reddit.com/r/freelance_demo/comments/aaa111/best_invoice_app/'),
          item(5, 'https://www.reddit.com/r/smallbiz_demo/comments/bbb222/old_thread/', {
            publishedAt: NOW - 400 * DAY,
          }),
        ],
      },
      'late payment reminder': {
        ok: true,
        costUsd: 0.004,
        items: [
          item(3, 'https://www.reddit.com/r/freelance_demo/comments/ccc333/reminders/', {
            publishedAt: null,
          }),
        ],
      },
    });
    const result = await runEvergreenCheck(
      { db, fetchSerp, log: silentLogger(), now: NOW },
      { productId: 'p1', keywords: ['invoice app', 'late payment reminder'], trigger: 'manual' },
    );
    expect(result).toMatchObject({ ok: true, status: 'ok', threads: 3, costUsd: 0.008 });
    if (!result.ok) return;
    const threads = threadsForRun(db, result.runId);
    expect(
      threads.map((thread) => [thread.keyword, thread.rank, thread.subreddit, thread.archived]),
    ).toEqual([
      ['invoice app', 2, 'freelance_demo', false],
      ['invoice app', 5, 'smallbiz_demo', true],
      ['late payment reminder', 3, 'freelance_demo', false],
    ]);
    expect(threads[0]?.title).toBe('Result 2');
    expect(recentSerpRuns(db, 'p1', 5)[0]).toMatchObject({
      status: 'ok',
      keywords: 2,
      threads: 3,
      costUsd: 0.008,
      finishedAt: NOW,
    });
  });

  it('updates a thread found again instead of adding it twice', async () => {
    const db = setup();
    const url = 'https://www.reddit.com/r/freelance_demo/comments/aaa111/best_invoice_app/';
    const first = fetcher({ k: { ok: true, costUsd: 0.004, items: [item(4, url)] } });
    await runEvergreenCheck(
      { db, fetchSerp: first.fetchSerp, log: silentLogger(), now: NOW },
      { productId: 'p1', keywords: ['k'], trigger: 'manual' },
    );
    const second = fetcher({ k: { ok: true, costUsd: 0.004, items: [item(2, url)] } });
    const result = await runEvergreenCheck(
      { db, fetchSerp: second.fetchSerp, log: silentLogger(), now: NOW + 7 * DAY },
      { productId: 'p1', keywords: ['k'], trigger: 'schedule' },
    );
    expect(result.ok && threadsForRun(db, result.runId).map((thread) => thread.rank)).toEqual([2]);
  });

  it('stops after a credentials or funds failure and still records what was spent', async () => {
    const db = setup();
    const { fetchSerp, asked } = fetcher({
      a: { ok: false, kind: 'funds', message: 'DataForSEO: Insufficient funds.', costUsd: 0 },
    });
    const keywords = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const result = await runEvergreenCheck(
      { db, fetchSerp, log: silentLogger(), now: NOW },
      { productId: 'p1', keywords, trigger: 'manual' },
    );
    expect(result).toMatchObject({
      ok: true,
      status: 'partial',
      error: 'DataForSEO: Insufficient funds.',
    });
    // The keywords already in flight finish; nothing new starts after the failure.
    expect(asked.length).toBeLessThan(keywords.length);
  });

  it('marks a run failed when every keyword fails', async () => {
    const db = setup();
    const { fetchSerp } = fetcher({
      a: { ok: false, kind: 'auth', message: 'DataForSEO: You are not authorized.', costUsd: 0 },
    });
    const result = await runEvergreenCheck(
      { db, fetchSerp, log: silentLogger(), now: NOW },
      { productId: 'p1', keywords: ['a'], trigger: 'manual' },
    );
    expect(result).toMatchObject({ ok: true, status: 'failed', threads: 0 });
  });

  it('refuses to start without keywords or while another check runs', async () => {
    const db = setup();
    const slow = {
      fetchSerp: () =>
        new Promise<SerpResponse>((resolve) => {
          setTimeout(() => {
            resolve({ ok: true, items: [], costUsd: 0 });
          }, 20);
        }),
    };
    const deps = { db, fetchSerp: slow.fetchSerp, log: silentLogger(), now: NOW };
    expect(
      await runEvergreenCheck(deps, { productId: 'p1', keywords: [], trigger: 'manual' }),
    ).toEqual({ ok: false, message: 'Add at least one keyword to check.' });
    const running = runEvergreenCheck(deps, {
      productId: 'p1',
      keywords: ['a'],
      trigger: 'manual',
    });
    expect(
      await runEvergreenCheck(deps, { productId: 'p1', keywords: ['b'], trigger: 'manual' }),
    ).toEqual({ ok: false, message: 'A check is already running for this product.' });
    await running;
  });

  it('is due weekly, counting failed attempts too', async () => {
    const db = setup();
    expect(evergreenDue(db, 'p1', NOW)).toBe(true);
    await runEvergreenCheck(
      { db, fetchSerp: fetcher({}).fetchSerp, log: silentLogger(), now: NOW },
      { productId: 'p1', keywords: ['a'], trigger: 'schedule' },
    );
    expect(evergreenDue(db, 'p1', NOW + 6 * DAY)).toBe(false);
    expect(evergreenDue(db, 'p1', NOW + 7 * DAY)).toBe(true);
  });
});
