import { describe, expect, it } from 'vitest';
import { createAiClient } from '../ai/client';
import { createFakeGenerator } from '../ai/fake';
import { silentLogger } from '../log';
import type { FetchResult, RedditPost, RedditSource } from '../reddit/types';
import { loadSampleProduct } from '../testing/sample-products';
import {
  estimatePostsPerDay,
  suggestSubreddits,
  validateSubreddit,
  validateSubreddits,
} from './subreddits';

const NOW = 1_800_000_000;
const HOUR = 3600;

function post(id: string, createdAt: number): RedditPost {
  return {
    id,
    subreddit: 'freelance_demo',
    author: 'demo_user_01',
    title: 'title',
    bodyText: 'body',
    bodyLinks: [],
    url: 'https://www.reddit.com/r/freelance_demo/comments/x/y/',
    imageUrl: null,
    createdAt,
    archived: false,
  };
}

function source(results: Record<string, FetchResult>) {
  const reads: string[] = [];
  const reddit: RedditSource = {
    fetchNewPosts: (names) => {
      const name = names[0] ?? '';
      reads.push(name);
      return Promise.resolve(results[name] ?? { ok: false, kind: 'gone' });
    },
  };
  return { reddit, reads };
}

const rate = { used: 1, remaining: 0, resetS: 50 };

describe('estimatePostsPerDay', () => {
  it('is zero for an empty feed', () => {
    expect(estimatePostsPerDay([], NOW)).toBe(0);
  });

  it('divides the number of posts by the days they span', () => {
    const posts = Array.from({ length: 10 }, (_, i) =>
      post(`t3_${i}`, NOW - i * ((2 * 24 * HOUR) / 9)),
    );
    expect(estimatePostsPerDay(posts, NOW)).toBe(5);
  });

  it('treats very recent bursts as spanning at least an hour', () => {
    const posts = [post('t3_a', NOW - 60), post('t3_b', NOW - 120)];
    expect(estimatePostsPerDay(posts, NOW)).toBe(48);
  });
});

describe('validateSubreddit', () => {
  it('confirms a readable subreddit and estimates its activity', async () => {
    const { reddit } = source({
      freelance_demo: { ok: true, posts: [post('t3_a', NOW - 12 * HOUR)], rate },
    });
    expect(await validateSubreddit(reddit, 'r/Freelance_Demo', NOW)).toEqual({
      name: 'freelance_demo',
      status: 'ok',
      postsPerDay: 2,
    });
  });

  it('reports a subreddit that does not exist', async () => {
    const { reddit } = source({});
    expect(await validateSubreddit(reddit, 'no_such_demo', NOW)).toEqual({
      name: 'no_such_demo',
      status: 'gone',
    });
  });

  it('reports a temporary failure separately from a missing subreddit', async () => {
    const { reddit } = source({
      busy_demo: { ok: false, kind: 'rate_limited', retryAfterS: 60, message: 'slow down' },
    });
    expect(await validateSubreddit(reddit, 'busy_demo', NOW)).toEqual({
      name: 'busy_demo',
      status: 'unavailable',
      message: 'slow down',
      retryAfterS: 60,
    });
  });
});

describe('validateSubreddits', () => {
  it('checks each subreddit in turn and reports progress', async () => {
    const { reddit } = source({
      a_demo: { ok: true, posts: [], rate },
      b_demo: { ok: true, posts: [], rate },
    });
    const progress: string[] = [];
    const results = await validateSubreddits(reddit, ['a_demo', 'b_demo'], NOW, (done, total) =>
      progress.push(`${done}/${total}`),
    );
    expect(results.map((result) => result.status)).toEqual(['ok', 'ok']);
    expect(progress).toEqual(['1/2', '2/2']);
  });

  it('stops reading after Reddit blocks requests', async () => {
    const { reddit, reads } = source({
      a_demo: { ok: false, kind: 'blocked', retryAfterS: 600, message: 'blocked' },
      b_demo: { ok: true, posts: [], rate },
    });
    const results = await validateSubreddits(reddit, ['a_demo', 'b_demo'], NOW);
    expect(reads).toEqual(['a_demo']);
    expect(results.map((result) => result.status)).toEqual(['unavailable', 'unavailable']);
  });
});

describe('suggestSubreddits', () => {
  it('returns cleaned suggestions from the model', async () => {
    const generator = createFakeGenerator(() => ({
      output: {
        suggestions: [
          {
            name: 'r/freelance_demo',
            reason: 'Freelancers ask about clients',
            promotion_strictness: 'strict',
          },
          {
            name: 'smallbiz_demo',
            reason: 'Owners discuss cash flow',
            promotion_strictness: 'moderate',
          },
        ],
      },
    }));
    const ai = createAiClient({
      generator,
      resolveModel: () => ({
        ok: true,
        model: { provider: 'openai', model: 'strong' },
        credentials: { apiKey: '', baseUrl: null },
      }),
      usage: { check: () => ({ ok: true }), record: () => null },
      redact: (text) => text,
      log: silentLogger(),
    });
    const result = await suggestSubreddits(ai, loadSampleProduct('acme-invoices'));
    expect(result).toEqual({
      ok: true,
      suggestions: [
        {
          name: 'freelance_demo',
          reason: 'Freelancers ask about clients',
          promotionStrictness: 'strict',
        },
        {
          name: 'smallbiz_demo',
          reason: 'Owners discuss cash flow',
          promotionStrictness: 'moderate',
        },
      ],
    });
    expect(generator.calls[0]?.task).toBe('subreddits');
  });
});
