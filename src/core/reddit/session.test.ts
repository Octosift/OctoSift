import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../testing/fake-clock';
import { createRateLimiter } from './ratelimit';
import { createSessionSource, parseListing } from './session';
import { createSessionClient } from './session-client';

const NOW = 1_800_000_000;
const COOKIE = 'reddit_session=synthetic-session-value; token_v2=synthetic-token';
const fixture = (name: string) =>
  readFileSync(resolve(process.cwd(), 'fixtures/session', name), 'utf8');
const json = (name: string): unknown => JSON.parse(fixture(name));

/** A fake HTTP layer keyed by path; records every request. */
function http(routes: Record<string, () => Response>) {
  const requests: { url: string; headers: Headers }[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    requests.push({ url, headers: new Headers(init?.headers) });
    const path = url.replace('https://www.reddit.com', '');
    const route = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    return Promise.resolve(route ? route[1]() : new Response('{}', { status: 404 }));
  };
  return { requests, fetchImpl };
}

const ok = (body: unknown) => () =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function setup(routes: Record<string, () => Response>, cookie: string | null = COOKIE) {
  const clock = createFakeClock(NOW * 1000);
  const { requests, fetchImpl } = http(routes);
  const invalid: string[] = [];
  const client = createSessionClient({
    cookie: () => cookie,
    userAgent: () => 'Mozilla/5.0 (Macintosh) TestBrowser/1.0',
    limiter: createRateLimiter({
      clock,
      random: () => 0,
      minSpacingMs: 8_000,
      maxJitterMs: 0,
      maxWaitMs: 120_000,
      maxPerHour: 120,
    }),
    clock,
    onInvalid: (reason) => invalid.push(reason),
    fetchImpl,
  });
  const source = createSessionSource({ client, clock, maxPostAgeHours: () => 48 });
  return { clock, requests, invalid, client, source };
}

describe('parseListing', () => {
  it('reads every field the pipeline needs from a listing page', () => {
    const page = parseListing(json('hot-page-1.json'), NOW);
    expect(page?.after).toBe('t3_sess06');
    const byId = new Map(page?.posts.map((post) => [post.id, post]));
    expect(byId.get('t3_sess02')).toMatchObject({
      subreddit: 'freelance_demo',
      title: 'Clients keep paying me 60 days late',
      bodyText:
        "Every client pays late & I'm tired of chasing. See my tracker: https://docs.example.com/tracker",
      bodyLinks: ['https://docs.example.com/tracker'],
      url: 'https://www.reddit.com/r/freelance_demo/comments/sess02/clients_keep_paying_late/',
      createdAt: NOW - 2 * 3600,
      score: 14,
      commentCount: 9,
      locked: false,
      nsfw: false,
      removed: false,
      stickied: false,
    });
    expect(byId.get('t3_sess01')?.stickied).toBe(true);
    expect(byId.get('t3_sess03')?.locked).toBe(true);
    expect(byId.get('t3_sess05')?.removed).toBe(true);
    expect(byId.get('t3_sess06')?.nsfw).toBe(true);
    expect(byId.get('t3_sess04')?.imageUrl).toBe(
      'https://preview.redd.it/demo_invoice.png?width=640&format=png',
    );
  });

  it('rejects anything that is not a listing', () => {
    expect(parseListing({ error: 403 }, NOW)).toBeNull();
  });
});

describe('session source', () => {
  it('reads hot pages until old posts appear, drops pinned posts and sorts newest first', async () => {
    const { source, requests } = setup({
      '/r/freelance_demo.json?limit=100&raw_json=1&after=t3_sess06': ok(json('hot-page-2.json')),
      '/r/freelance_demo.json?limit=100&raw_json=1': ok(json('hot-page-1.json')),
    });
    const result = await source.fetchNewPosts(['freelance_demo'], { limit: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts.map((post) => post.id)).toEqual([
      't3_sess02',
      't3_sess03',
      't3_sess04',
      't3_sess05',
      't3_sess06',
      't3_sess07',
      't3_sess08',
    ]);
    // Page two holds a post older than 48 hours, so no third page is read.
    expect(requests).toHaveLength(2);
  });

  it('stops after a page with a post already stored', async () => {
    const { source, requests } = setup({
      '/r/freelance_demo.json': ok(json('hot-page-1.json')),
    });
    await source.fetchNewPosts(['freelance_demo'], {
      limit: 100,
      knownIds: (ids) => new Set(ids.filter((id) => id === 't3_sess04')),
    });
    expect(requests).toHaveLength(1);
  });

  it('adds the day top for a subreddit too busy for three hot pages', async () => {
    const busyPage = (page: number) => ({
      kind: 'Listing',
      data: {
        after: page < 3 ? `t3_busy${String(page)}99` : null,
        children: Array.from({ length: 100 }, (_, index) => ({
          kind: 't3',
          data: {
            id: `busy${String(page)}${String(index).padStart(2, '0')}`,
            subreddit: 'busy_demo',
            author: 'demo_user_busy',
            title: `Busy post ${String(page)}-${String(index)}`,
            selftext: 'Synthetic busy post.',
            created_utc: NOW - (page * 100 + index) * 60,
            permalink: `/r/busy_demo/comments/busy${String(page)}${String(index)}/x/`,
          },
        })),
      },
    });
    const { source, requests } = setup({
      '/r/busy_demo.json?limit=100&raw_json=1&after=t3_busy199': ok(busyPage(2)),
      '/r/busy_demo.json?limit=100&raw_json=1&after=t3_busy299': ok(busyPage(3)),
      '/r/busy_demo.json': ok(busyPage(1)),
      '/r/busy_demo/top.json': ok(json('top-day.json')),
    });
    const result = await source.fetchNewPosts(['busy_demo'], { limit: 100 });
    expect(requests.map((request) => request.url.replace('https://www.reddit.com', ''))).toEqual([
      '/r/busy_demo.json?limit=100&raw_json=1',
      '/r/busy_demo.json?limit=100&raw_json=1&after=t3_busy199',
      '/r/busy_demo.json?limit=100&raw_json=1&after=t3_busy299',
      '/r/busy_demo/top.json?t=day&limit=100&raw_json=1',
    ]);
    expect(result.ok && result.posts).toHaveLength(301);
  });

  it('reports a subreddit that does not exist', async () => {
    const { source } = setup({
      '/r/missing_demo.json': () =>
        new Response(null, { status: 302, headers: { location: '/subreddits/search.json?q=x' } }),
    });
    expect(await source.fetchNewPosts(['missing_demo'], { limit: 100 })).toMatchObject({
      ok: false,
      kind: 'gone',
    });
  });
});

describe('session client', () => {
  it('sends the cookie and a browser User-Agent to www.reddit.com only, one request at a time', async () => {
    const { client, requests, clock } = setup({ '/r/a_demo.json': ok(json('top-day.json')) });
    await client.getJson('/r/a_demo.json');
    await client.getJson('/r/a_demo.json');
    expect(requests.every((request) => request.url.startsWith('https://www.reddit.com/'))).toBe(
      true,
    );
    expect(requests[0]?.headers.get('cookie')).toBe(COOKIE);
    expect(requests[0]?.headers.get('user-agent')).toContain('Mozilla/5.0');
    expect(clock.sleeps).toEqual([8_000]);
  });

  it.each([
    [
      'a sign-in redirect',
      () => new Response(null, { status: 302, headers: { location: '/login/?dest=x' } }),
    ],
    ['HTTP 403', () => new Response('forbidden', { status: 403 })],
    ['HTTP 401', () => new Response('', { status: 401 })],
    [
      'a block page',
      () => new Response(fixture('blocked.html'), { headers: { 'content-type': 'text/html' } }),
    ],
  ])(
    'treats %s as a session that needs reconnecting, once, without retrying',
    async (_, respond) => {
      const { client, requests, invalid } = setup({ '/r/a_demo.json': respond });
      expect(await client.getJson('/r/a_demo.json')).toMatchObject({ ok: false, kind: 'auth' });
      expect(await client.getJson('/r/a_demo.json')).toMatchObject({ ok: false, kind: 'auth' });
      expect(requests).toHaveLength(1);
      expect(invalid).toHaveLength(1);
      expect(invalid[0]).not.toContain('synthetic-session-value');
    },
  );

  it('makes no request without a connected account', async () => {
    const { client, requests } = setup({}, null);
    expect(await client.getJson('/r/a_demo.json')).toMatchObject({ ok: false, kind: 'auth' });
    expect(requests).toHaveLength(0);
  });

  it('passes on a rate limit with the wait Reddit asked for', async () => {
    const { client } = setup({
      '/r/a_demo.json': () => new Response('', { status: 429, headers: { 'retry-after': '120' } }),
    });
    expect(await client.getJson('/r/a_demo.json')).toEqual({
      ok: false,
      kind: 'rate_limited',
      message: 'Reddit asked to slow down',
      retryAfterS: 120,
    });
  });
});
