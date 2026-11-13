import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../testing/fake-clock';
import type { FeedResponse, RedditClient } from './client';
import { createAtomSource } from './source';

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, '../../../fixtures/atom', name), 'utf8');

function setup(responses: FeedResponse[]) {
  const paths: string[] = [];
  const client: RedditClient = {
    getFeed: (path) => {
      paths.push(path);
      return Promise.resolve(responses.shift() ?? { ok: false, kind: 'network', message: 'none' });
    },
  };
  const source = createAtomSource({ client, clock: createFakeClock() });
  return { source, paths };
}

const rate = { used: 1, remaining: 0, resetS: 54 };

describe('AtomSource.fetchNewPosts', () => {
  it('reads one subreddit from its new-posts feed', async () => {
    const { source, paths } = setup([{ ok: true, body: fixture('subreddit-feed.xml'), rate }]);
    const result = await source.fetchNewPosts(['Freelance_Demo'], { limit: 100 });
    expect(paths).toEqual(['/r/freelance_demo/new/.rss?limit=100']);
    expect(result.ok && result.posts.map((post) => post.id)).toEqual([
      't3_1fd0001',
      't3_1fd0002',
      't3_1fd0003',
      't3_1fd0004',
    ]);
    expect(result.ok && result.rate).toEqual(rate);
  });

  it('reads several subreddits with one combined feed request', async () => {
    const { source, paths } = setup([{ ok: true, body: fixture('subreddit-feed.xml'), rate }]);
    await source.fetchNewPosts(['freelance_demo', 'smallbiz_demo', 'r/plantcare_demo'], {
      limit: 50,
    });
    expect(paths).toEqual(['/r/freelance_demo+smallbiz_demo+plantcare_demo/new/.rss?limit=50']);
  });

  it('reports a missing subreddit for a "page not found" feed', async () => {
    const { source } = setup([{ ok: true, body: fixture('not-found.xml'), rate }]);
    expect(await source.fetchNewPosts(['no_such_demo'], { limit: 100 })).toEqual({
      ok: false,
      kind: 'gone',
    });
  });

  it('reports an unreadable feed as a network failure with the reason', async () => {
    const { source } = setup([{ ok: true, body: fixture('entity-expansion.xml'), rate }]);
    const result = await source.fetchNewPosts(['freelance_demo'], { limit: 100 });
    expect(result).toMatchObject({ ok: false, kind: 'network' });
  });

  it('passes through blocks with the time until reads resume', async () => {
    const { source } = setup([
      { ok: false, kind: 'blocked', retryAfterS: 600, message: 'Reddit answered HTTP 403' },
    ]);
    expect(await source.fetchNewPosts(['freelance_demo'], { limit: 100 })).toEqual({
      ok: false,
      kind: 'blocked',
      retryAfterS: 600,
      message: 'Reddit answered HTTP 403',
    });
  });

  it('refuses names that are not valid subreddit names without making a request', async () => {
    const { source, paths } = setup([]);
    const result = await source.fetchNewPosts(['bad name/../x'], { limit: 100 });
    expect(result).toMatchObject({ ok: false, kind: 'gone' });
    expect(paths).toEqual([]);
  });
});

describe('AtomSource.fetchPostWithComments', () => {
  it('reads the post feed and returns the post', async () => {
    const { source, paths } = setup([{ ok: true, body: fixture('subreddit-feed.xml'), rate }]);
    const thread = await source.fetchPostWithComments('freelance_demo', 't3_1fd0001');
    expect(paths).toEqual(['/r/freelance_demo/comments/1fd0001/.rss']);
    expect(thread?.post.id).toBe('t3_1fd0001');
  });

  it('returns null when the read fails', async () => {
    const { source } = setup([{ ok: false, kind: 'network', message: 'down' }]);
    expect(await source.fetchPostWithComments('freelance_demo', 't3_1fd0001')).toBeNull();
  });
});
