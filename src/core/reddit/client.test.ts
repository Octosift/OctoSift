import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { silentLogger } from '../log';
import { createFakeClock } from '../testing/fake-clock';
import { createRedditClient, type Transport } from './client';
import { createRateLimiter } from './ratelimit';

const FEED =
  '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title></feed>';

interface Reply {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  throws?: unknown;
}

function setup(replies: Reply[], options: { proxyUrl?: string; userAgent?: string } = {}) {
  const clock = createFakeClock(1_000_000);
  const limiter = createRateLimiter({
    clock,
    random: () => 0,
    minSpacingMs: CONFIG.reddit.minSpacingMs,
    maxJitterMs: CONFIG.reddit.maxJitterMs,
    maxWaitMs: 120_000,
  });
  const calls: {
    url: string;
    headers: Record<string, string>;
    proxyUrl: string | null;
    at: number;
  }[] = [];
  const blocks: number[] = [];
  const transport: Transport = (request) => {
    calls.push({ ...request, at: clock.nowMs() });
    const reply = replies.shift() ?? { status: 200, body: FEED };
    if (reply.throws !== undefined) {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercises non-Error rejections on purpose
      return Promise.reject(reply.throws);
    }
    return Promise.resolve(
      new Response(reply.body ?? '', { status: reply.status ?? 200, headers: reply.headers ?? {} }),
    );
  };
  const client = createRedditClient({
    transport,
    limiter,
    clock,
    log: silentLogger(),
    userAgent: () => options.userAgent ?? 'Test Agent/1.0',
    proxyUrl: () => options.proxyUrl ?? null,
    onBlock: (untilMs) => blocks.push(untilMs),
  });
  return { client, calls, clock, limiter, blocks };
}

const PATH = '/r/freelance_demo/new/.rss?limit=100';

describe('reddit client', () => {
  it('returns the feed body and the rate-limit headers', async () => {
    const { client, calls } = setup([
      {
        body: FEED,
        headers: {
          'x-ratelimit-used': '1',
          'x-ratelimit-remaining': '99.0',
          'x-ratelimit-reset': '54',
        },
      },
    ]);
    expect(await client.getFeed(PATH)).toEqual({
      ok: true,
      body: FEED,
      rate: { used: 1, remaining: 99, resetS: 54 },
    });
    expect(calls[0]?.url).toBe(`https://www.reddit.com${PATH}`);
  });

  it('sends the configured User-Agent and asks for Atom', async () => {
    const { client, calls } = setup([{ body: FEED }], { userAgent: 'Custom Browser/2.0' });
    await client.getFeed(PATH);
    expect(calls[0]?.headers).toMatchObject({
      'User-Agent': 'Custom Browser/2.0',
      Accept: 'application/atom+xml',
    });
  });

  it('serves repeated reads from the cache until it expires', async () => {
    const { client, calls, clock } = setup([{ body: FEED }, { body: FEED }]);
    await client.getFeed(PATH);
    await client.getFeed(PATH);
    expect(calls).toHaveLength(1);
    clock.advance(CONFIG.reddit.cacheTtlMs + 1);
    await client.getFeed(PATH);
    expect(calls).toHaveLength(2);
  });

  it('treats HTTP 429 as rate limited and pauses every read without retrying', async () => {
    const { client, calls, blocks, clock } = setup([{ status: 429 }]);
    const result = await client.getFeed(PATH);
    expect(result).toMatchObject({ ok: false, kind: 'rate_limited', retryAfterS: 600 });
    expect(calls).toHaveLength(1);
    expect(blocks).toEqual([clock.nowMs() + CONFIG.reddit.blockPauseMs]);
    expect(await client.getFeed('/r/other_demo/new/.rss')).toMatchObject({
      ok: false,
      kind: 'blocked',
    });
    expect(calls).toHaveLength(1);
  });

  it('pauses for retry-after when it is longer than the default pause', async () => {
    const { client } = setup([{ status: 429, headers: { 'retry-after': '1800' } }]);
    expect(await client.getFeed(PATH)).toMatchObject({ kind: 'rate_limited', retryAfterS: 1800 });
  });

  it('treats HTTP 403 as a block', async () => {
    const { client, blocks } = setup([{ status: 403 }]);
    expect(await client.getFeed(PATH)).toMatchObject({ ok: false, kind: 'blocked' });
    expect(blocks).toHaveLength(1);
  });

  it('treats a redirect to a login page as a block', async () => {
    const { client } = setup([
      { status: 302, headers: { location: 'https://www.reddit.com/login/?dest=x' } },
    ]);
    expect(await client.getFeed(PATH)).toMatchObject({ ok: false, kind: 'blocked' });
  });

  it('treats any other redirect as a missing subreddit', async () => {
    const { client, blocks } = setup([
      { status: 302, headers: { location: 'https://www.reddit.com/subreddits/search?q=x' } },
    ]);
    expect(await client.getFeed(PATH)).toMatchObject({ ok: false, kind: 'gone' });
    expect(blocks).toEqual([]);
  });

  it('treats HTTP 404 as a missing subreddit', async () => {
    const { client } = setup([{ status: 404 }]);
    expect(await client.getFeed(PATH)).toMatchObject({ ok: false, kind: 'gone' });
  });

  it.each(CONFIG.reddit.blockMarkers)(
    'treats a page containing "%s" as a block',
    async (marker) => {
      const { client } = setup([
        { body: `<html><body><h1>${marker.toUpperCase()}</h1></body></html>` },
      ]);
      expect(await client.getFeed(PATH)).toMatchObject({ ok: false, kind: 'blocked' });
    },
  );

  it('retries network errors twice with growing delays, then gives up', async () => {
    const { client, calls } = setup([
      { throws: new TypeError('fetch failed') },
      { throws: new TypeError('fetch failed') },
      { throws: new TypeError('fetch failed') },
    ]);
    const result = await client.getFeed(PATH);
    expect(result).toMatchObject({ ok: false, kind: 'network' });
    expect(calls).toHaveLength(3);
    const [first, second, third] = calls.map((call) => call.at);
    expect((second ?? 0) - (first ?? 0)).toBeGreaterThanOrEqual(CONFIG.reddit.retryBaseDelayMs);
    expect((third ?? 0) - (second ?? 0)).toBeGreaterThanOrEqual(CONFIG.reddit.retryBaseDelayMs * 2);
  });

  it('retries server errors and returns the feed when a retry succeeds', async () => {
    const { client, calls } = setup([{ status: 502 }, { status: 503 }, { body: FEED }]);
    expect(await client.getFeed(PATH)).toMatchObject({ ok: true, body: FEED });
    expect(calls).toHaveLength(3);
  });

  it('never throws, even when the transport rejects with a non-error value', async () => {
    const { client } = setup([{ throws: 'weird' }, { throws: 'weird' }, { throws: 'weird' }]);
    await expect(client.getFeed(PATH)).resolves.toMatchObject({ ok: false, kind: 'network' });
  });

  it('waits for the rate-limit window to reset before the next request', async () => {
    const { client, calls } = setup([
      { body: FEED, headers: { 'x-ratelimit-remaining': '0.0', 'x-ratelimit-reset': '54' } },
      { body: FEED },
    ]);
    await client.getFeed(PATH);
    await client.getFeed('/r/other_demo/new/.rss');
    expect((calls[1]?.at ?? 0) - (calls[0]?.at ?? 0)).toBeGreaterThanOrEqual(54_000);
  });

  it('hands the proxy URL to the transport when one is configured', async () => {
    const { client, calls } = setup([{ body: FEED }], {
      proxyUrl: 'http://proxy.example.com:8080',
    });
    await client.getFeed(PATH);
    expect(calls[0]?.proxyUrl).toBe('http://proxy.example.com:8080');
  });
});
