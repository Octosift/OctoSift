import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../../testing/fake-clock';
import { createRateLimiter } from '../ratelimit';
import type { SpendHooks } from '../types';
import { createProviderSource } from './source';
import { createVendorClient } from './vendor';
import {
  containsComment,
  parseCommunityNames,
  parseDetails,
  parseFeedPage,
  postPresent,
} from './vendor-parse';

const NOW = 1_800_000_000;
const KEY = 'synthetic-provider-key-0000';
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/provider', `${name}.json`), 'utf8'));
const errors = fixture('errors') as Record<string, unknown>;

type Route = (url: URL) => Response | Promise<Response>;

function setup(route: Route, key: string | null = KEY) {
  const clock = createFakeClock(NOW * 1000);
  const requests: { url: URL; auth: string | null }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push({ url, auth: new Headers(init?.headers).get('authorization') });
    return route(url);
  };
  const client = createVendorClient({
    key: () => key,
    limiter: createRateLimiter({
      clock,
      random: () => 0,
      minSpacingMs: 200,
      maxJitterMs: 0,
      maxWaitMs: 10_000,
    }),
    clock,
    redact: (text) => text.replaceAll(KEY, '[key]'),
    fetchImpl,
  });
  const source = createProviderSource({
    client,
    clock,
    maxPostAgeHours: () => 48,
    pricePerRequestUsd: () => 0.001,
    name: 'vendor',
  });
  const spent: [number, string][] = [];
  let refusal: string | null = null;
  const spend: SpendHooks = {
    refuse: () => refusal,
    record: (cost, what) => spent.push([cost, what]),
  };
  return {
    clock,
    requests,
    client,
    source,
    spend,
    spent,
    refuseFrom: (reason: string) => {
      refusal = reason;
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const feedRoute: Route = (url) => {
  if (url.pathname.endsWith('/subreddit_feed')) {
    return json(fixture(url.searchParams.get('after') ? 'feed-page-2' : 'feed-page-1'));
  }
  if (url.pathname.endsWith('/post_details_batch')) return json(fixture('details'));
  return json(errors.unknown);
};

describe('Vendor responses', () => {
  it('keeps the posts of a feed page and skips ads, carousels and the sort cell', () => {
    const page = parseFeedPage(
      (fixture('feed-page-1') as { data: unknown }).data,
      'freelance_demo',
      NOW,
    );
    expect(page?.next).toBe('synthetic-cursor-2');
    expect(page?.posts.map((post) => post.id)).toEqual(['t3_prv001', 't3_prv002', 't3_prv003']);
    expect(page?.posts[0]).toMatchObject({
      author: 'demo_user_31',
      title: 'Clients pay me late every month',
      createdAt: NOW - 3600,
      url: 'https://www.reddit.com/r/freelance_demo/comments/prv001/',
      partial: true,
    });
    expect(page?.posts[1]?.imageUrl).toBe('https://preview.redd.it/demo_layout.png?width=640');
  });

  it('treats an answer without a feed as no such subreddit, and missing cells as empty fields', () => {
    expect(parseFeedPage({ subredditV3: null }, 'x_demo', NOW)).toBeNull();
    const bare = parseFeedPage(
      {
        subredditV3: {
          elements: {
            edges: [{ node: { __typename: 'CellGroup', groupId: 't3_bare01', cells: [] } }],
          },
        },
      },
      'x_demo',
      NOW,
    );
    expect(bare?.posts[0]).toMatchObject({
      id: 't3_bare01',
      title: '',
      bodyText: '',
      author: '[unknown]',
    });
  });

  it('reads full posts from a details batch, wherever they are nested', () => {
    const posts = parseDetails((fixture('details') as { data: unknown }).data, NOW);
    expect(posts).toHaveLength(3);
    expect(posts[0]).toMatchObject({
      id: 't3_prv001',
      score: 12,
      commentCount: 7,
      locked: false,
      partial: false,
      url: 'https://www.reddit.com/r/freelance_demo/comments/prv001/synthetic_post/',
      bodyLinks: ['https://docs.example.com/my-tracker'],
    });
    expect(posts[1]?.locked).toBe(true);
  });

  it('finds communities and comments', () => {
    expect(parseCommunityNames((fixture('search-communities') as { data: unknown }).data)).toEqual([
      'freelance_demo',
      'freelance_writing_demo',
    ]);
    const comments = (fixture('comments') as { data: unknown }).data;
    expect(containsComment(comments, 't1_cmt001')).toBe(true);
    expect(containsComment(comments, 't1_missing')).toBe(false);
    expect(postPresent(comments)).toBe(true);
    expect(postPresent((fixture('comments-post-gone') as { data: unknown }).data)).toBe(false);
  });
});

describe('Vendor client', () => {
  it('sends the key as a bearer token and bills only successful answers', async () => {
    const { client, requests } = setup(() => json(errors.rate));
    const answer = await client.get('/v1/reddit/subreddit_feed', {
      subreddit_name: 'a_demo',
    });
    expect(requests[0]?.auth).toBe(`Bearer ${KEY}`);
    expect(requests[0]?.url.origin).toBe('https://api.data-vendor.example');
    expect(answer).toMatchObject({ ok: false, kind: 'rate_limited', billed: false });
  });

  it('maps an invalid key to a problem the user must fix, and never repeats the key', async () => {
    const { client } = setup(() => json({ code: 401, message: `Invalid API key ${KEY}` }, 401));
    const answer = await client.get('/x', {});
    expect(answer).toMatchObject({ ok: false, kind: 'auth' });
    expect(JSON.stringify(answer)).not.toContain(KEY);
  });

  it('retries server and network errors twice with a growing pause', async () => {
    let calls = 0;
    const { client, clock } = setup(() => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      if (calls === 2) return new Response('busy', { status: 503 });
      return json(fixture('details'));
    });
    const answer = await client.get('/x', {});
    expect(answer).toMatchObject({ ok: true, billed: true });
    expect(calls).toBe(3);
    expect(clock.sleeps.filter((ms) => ms >= 1_000)).toEqual([1_000, 2_000]);
  });

  it('gives up after the retries', async () => {
    const { client } = setup(() => new Response('down', { status: 502 }));
    expect(await client.get('/x', {})).toMatchObject({ ok: false, kind: 'network', billed: false });
  });

  it('makes no request without a key', async () => {
    const { client, requests } = setup(() => json({}), null);
    expect(await client.get('/x', {})).toMatchObject({ ok: false, kind: 'auth' });
    expect(requests).toHaveLength(0);
  });
});

describe('provider source', () => {
  it('reads feed pages until an old post appears and records each billed request', async () => {
    const { source, requests, spend, spent } = setup(feedRoute);
    const result = await source.fetchNewPosts(['freelance_demo'], { limit: 100, spend });
    expect(result.ok && result.posts.map((post) => post.id)).toEqual([
      't3_prv001',
      't3_prv002',
      't3_prv003',
      't3_prv004',
      't3_prv005',
    ]);
    expect(requests.map((request) => request.url.searchParams.get('after'))).toEqual([
      null,
      'synthetic-cursor-2',
    ]);
    expect(requests[0]?.url.searchParams.get('sort')).toBe('NEW');
    expect(spent).toEqual([
      [0.001, 'vendor/feed'],
      [0.001, 'vendor/feed'],
    ]);
  });

  it('says when its pages ran out before older posts, so the subreddit is read more often', async () => {
    // Every page is full of fresh posts and points to another one.
    const { source, spend } = setup(() => json(fixture('feed-page-1')));
    const busy = await source.fetchNewPosts(['freelance_demo'], { limit: 100, spend });
    expect(busy.ok && busy.truncated).toBe(true);
    const calm = await setup(feedRoute).source.fetchNewPosts(['freelance_demo'], { limit: 100 });
    expect(calm.ok && calm.truncated).toBe(false);
  });

  it('stops paging at a post already stored', async () => {
    const { source, requests, spend } = setup(feedRoute);
    await source.fetchNewPosts(['freelance_demo'], {
      limit: 100,
      spend,
      knownIds: (ids) => new Set(ids.filter((id) => id === 't3_prv003')),
    });
    expect(requests).toHaveLength(1);
  });

  it('fetches full posts in batches of 30', async () => {
    const { source, requests, spend, spent } = setup(feedRoute);
    const ids = Array.from({ length: 31 }, (_, index) => `t3_prv${String(index).padStart(3, '0')}`);
    const result = await source.fetchDetails(ids, { spend });
    expect(result.ok && result.posts.map((post) => post.id)).toContain('t3_prv001');
    expect(
      requests.map((request) => request.url.searchParams.get('post_ids')?.split(',').length),
    ).toEqual([30, 1]);
    expect(spent).toHaveLength(2);
  });

  it('asks the budget before every request and stops when it refuses', async () => {
    const { source, requests, spend, refuseFrom } = setup(feedRoute);
    refuseFrom('The per-scan budget is spent');
    expect(await source.fetchNewPosts(['freelance_demo'], { limit: 100, spend })).toEqual({
      ok: false,
      kind: 'budget',
      message: 'The per-scan budget is spent',
    });
    expect(requests).toHaveLength(0);
  });

  it('reports a subreddit the provider does not know', async () => {
    const { source, spend } = setup(() => json({ code: 200, data: { subredditV3: null } }));
    expect(await source.fetchNewPosts(['missing_demo'], { limit: 100, spend })).toMatchObject({
      ok: false,
      kind: 'gone',
    });
  });
});
