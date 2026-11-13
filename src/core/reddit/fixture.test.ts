import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../testing/fake-clock';
import { parseFeed } from './atom';
import { buildAtomFeed, createFixtureClient } from './fixture';
import type { RedditPost } from './types';

const NOW_MS = Date.parse('2026-11-13T12:00:00Z');
const NOW = NOW_MS / 1000;

function post(overrides: Partial<RedditPost>): RedditPost {
  return {
    id: 't3_fx1',
    subreddit: 'freelance_demo',
    author: 'demo_user_01',
    title: 'Q&A: "invoices" <and> reminders',
    bodyText: 'First paragraph with a link https://docs.example/guide here.\n\nSecond paragraph.',
    bodyLinks: ['https://docs.example/guide'],
    url: 'https://www.reddit.com/r/freelance_demo/comments/fx1/demo_post/',
    imageUrl: null,
    createdAt: NOW - 3600,
    archived: false,
    ...overrides,
  };
}

describe('buildAtomFeed', () => {
  it('produces feeds that the Atom parser reads back unchanged', () => {
    const original = post({});
    const parsed = parseFeed(buildAtomFeed('feed', [original]), { now: NOW });
    expect(parsed).toEqual({ kind: 'posts', posts: [original] });
  });

  it('keeps image links and removed bodies recognisable', () => {
    const image = post({
      id: 't3_fx2',
      bodyText: '',
      bodyLinks: [],
      imageUrl: 'https://i.redd.it/x.png',
    });
    const removed = post({ id: 't3_fx3', bodyText: '[removed]', bodyLinks: [] });
    const parsed = parseFeed(buildAtomFeed('feed', [image, removed]), { now: NOW });
    expect(parsed.kind === 'posts' && parsed.posts.map((p) => [p.imageUrl, p.bodyText])).toEqual([
      ['https://i.redd.it/x.png', ''],
      [null, '[removed]'],
    ]);
  });
});

describe('createFixtureClient', () => {
  const posts = [
    post({ id: 't3_a1', createdAt: NOW - 100 }),
    post({ id: 't3_b1', subreddit: 'smallbiz_demo', createdAt: NOW - 50 }),
    post({ id: 't3_future', createdAt: NOW + 3600 }),
  ];

  it('serves combined feeds newest first and hides posts from the future', async () => {
    const client = createFixtureClient({ posts: () => posts, clock: createFakeClock(NOW_MS) });
    const response = await client.getFeed('/r/freelance_demo+smallbiz_demo/new/.rss?limit=100');
    const parsed = response.ok ? parseFeed(response.body, { now: NOW }) : null;
    expect(parsed?.kind === 'posts' && parsed.posts.map((p) => p.id)).toEqual(['t3_b1', 't3_a1']);
  });

  it('answers unknown subreddits with a "page not found" feed', async () => {
    const client = createFixtureClient({ posts: () => posts, clock: createFakeClock(NOW_MS) });
    const response = await client.getFeed('/r/no_such_demo/new/.rss?limit=100');
    expect(response.ok && parseFeed(response.body, { now: NOW })).toEqual({ kind: 'not_found' });
  });

  it('serves the feed of a single post', async () => {
    const client = createFixtureClient({ posts: () => posts, clock: createFakeClock(NOW_MS) });
    const response = await client.getFeed('/r/freelance_demo/comments/a1/.rss');
    const parsed = response.ok ? parseFeed(response.body, { now: NOW }) : null;
    expect(parsed?.kind === 'posts' && parsed.posts.map((p) => p.id)).toEqual(['t3_a1']);
  });
});
