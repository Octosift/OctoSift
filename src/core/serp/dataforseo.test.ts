import { describe, expect, it } from 'vitest';
import { createDataForSeoFetcher, DATAFORSEO_ENDPOINT, parseSerpTimestamp } from './dataforseo';

const CREDENTIALS = { login: 'demo@example.com', password: 'not-a-real-password' };

function respond(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { calls, fetch: createDataForSeoFetcher(CREDENTIALS, { fetchImpl }) };
}

function liveAnswer(items: unknown[], extra: Record<string, unknown> = {}) {
  return {
    status_code: 20000,
    status_message: 'Ok.',
    cost: 0.004,
    tasks: [{ status_code: 20000, status_message: 'Ok.', result: [{ items }] }],
    ...extra,
  };
}

describe('DataForSEO fetcher', () => {
  it('asks for the top 20 US English results with basic auth', async () => {
    const { calls, fetch } = respond(liveAnswer([]));
    await fetch('best invoicing app for freelancers');
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(DATAFORSEO_ENDPOINT);
    expect(call?.init?.method).toBe('POST');
    const headers = new Headers(call?.init?.headers);
    expect(headers.get('authorization')).toBe(
      `Basic ${Buffer.from('demo@example.com:not-a-real-password').toString('base64')}`,
    );
    expect(JSON.parse(typeof call?.init?.body === 'string' ? call.init.body : '')).toEqual([
      {
        keyword: 'best invoicing app for freelancers',
        location_code: 2840,
        language_code: 'en',
        device: 'desktop',
        depth: 20,
      },
    ]);
  });

  it('keeps organic results with their rank and date, and reports the cost', async () => {
    const { fetch } = respond(
      liveAnswer([
        { type: 'featured_snippet', url: 'https://example.com/a' },
        {
          type: 'organic',
          rank_group: 1,
          url: 'https://www.reddit.com/r/freelance_demo/comments/abc123/best_invoicing_app/',
          title: 'Best invoicing app? : r/freelance_demo',
          timestamp: '2026-03-02 12:57:46 +00:00',
        },
        { type: 'organic', rank_group: 2, url: 'https://example.com/blog', title: null },
        { type: 'organic', url: 'https://example.com/no-rank' },
      ]),
    );
    expect(await fetch('best invoicing app')).toEqual({
      ok: true,
      costUsd: 0.004,
      items: [
        {
          rank: 1,
          url: 'https://www.reddit.com/r/freelance_demo/comments/abc123/best_invoicing_app/',
          title: 'Best invoicing app? : r/freelance_demo',
          publishedAt: Date.UTC(2026, 2, 2, 12, 57, 46) / 1000,
        },
        { rank: 2, url: 'https://example.com/blog', title: '', publishedAt: null },
      ],
    });
  });

  it('treats "no search results" as an empty answer', async () => {
    const { fetch } = respond({
      status_code: 20000,
      cost: 0.002,
      tasks: [{ status_code: 40102, status_message: 'No Search Results.' }],
    });
    expect(await fetch('nothing ranks for this')).toEqual({ ok: true, items: [], costUsd: 0.002 });
  });

  it.each([
    [40100, 'auth'],
    [40200, 'funds'],
    [40210, 'funds'],
    [40202, 'rate_limited'],
    [40501, 'error'],
  ] as const)('maps status %i to %s', async (code, kind) => {
    const { fetch } = respond({
      status_code: code,
      status_message: 'Problem.',
      cost: 0,
      tasks: [],
    });
    expect(await fetch('keyword')).toEqual({
      ok: false,
      kind,
      message: 'DataForSEO: Problem.',
      costUsd: 0,
    });
  });

  it('maps HTTP errors and unreadable answers', async () => {
    expect(await respond({}, 401).fetch('keyword')).toMatchObject({ ok: false, kind: 'auth' });
    expect(await respond({}, 500).fetch('keyword')).toMatchObject({ ok: false, kind: 'error' });
    expect(await respond({ unexpected: true }).fetch('keyword')).toMatchObject({
      ok: false,
      kind: 'error',
      message: 'DataForSEO sent an unexpected answer',
    });
  });

  it('reports a network failure without throwing', async () => {
    const fetch = createDataForSeoFetcher(CREDENTIALS, {
      fetchImpl: () => Promise.reject(new TypeError('fetch failed')),
    });
    expect(await fetch('keyword')).toEqual({
      ok: false,
      kind: 'error',
      message: 'Could not reach DataForSEO',
      costUsd: 0,
    });
  });
});

describe('parseSerpTimestamp', () => {
  it.each([
    ['2026-03-02 12:57:46 +00:00', Date.UTC(2026, 2, 2, 12, 57, 46) / 1000],
    ['2026-03-02 12-57-46 +00:00', Date.UTC(2026, 2, 2, 12, 57, 46) / 1000],
    ['2026-03-02 14:57:46 +02:00', Date.UTC(2026, 2, 2, 12, 57, 46) / 1000],
    ['2026-03-02 00:00:00', Date.UTC(2026, 2, 2) / 1000],
  ])('reads %s', (raw, expected) => {
    expect(parseSerpTimestamp(raw)).toBe(expected);
  });

  it('returns null for missing or unreadable dates', () => {
    expect(parseSerpTimestamp(null)).toBeNull();
    expect(parseSerpTimestamp('last week')).toBeNull();
  });
});
