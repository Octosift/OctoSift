import { describe, expect, it } from 'vitest';
import { createSourceChain, sourceOrder, type SourceId } from './chain';
import type { FetchResult, RedditSource } from './types';

const OK: FetchResult = {
  ok: true,
  posts: [],
  rate: { used: null, remaining: null, resetS: null },
};

function source(results: FetchResult[], perRequest?: number) {
  const calls: string[][] = [];
  const answers = [...results];
  const value: RedditSource = {
    ...(perRequest !== undefined ? { maxSubredditsPerRequest: perRequest } : {}),
    fetchNewPosts: (names) => {
      calls.push(names);
      return Promise.resolve(answers.shift() ?? OK);
    },
  };
  return { calls, value };
}

describe('source chain', () => {
  it('orders the preferred source first and the rest in the default order', () => {
    expect(sourceOrder('session')).toEqual(['session', 'rss']);
    expect(sourceOrder('rss')).toEqual(['rss', 'session']);
  });

  it('uses the first source while it works', async () => {
    const session = source([OK], 1);
    const rss = source([OK], 5);
    const chain = createSourceChain(
      [
        { id: 'session', source: session.value },
        { id: 'rss', source: rss.value },
      ],
      { failover: true },
    );
    expect(chain.maxSubredditsPerRequest).toBe(1);
    expect(await chain.fetchNewPosts(['a_demo'], { limit: 100 })).toEqual(OK);
    expect(rss.calls).toEqual([]);
  });

  it('hands the rest of the scan to the next source when an account stops working', async () => {
    const session = source(
      [{ ok: false, kind: 'auth', message: 'Reddit asked to sign in again' }],
      1,
    );
    const rss = source([OK, OK], 5);
    const switches: [SourceId, SourceId | null, string][] = [];
    const chain = createSourceChain(
      [
        { id: 'session', source: session.value },
        { id: 'rss', source: rss.value },
      ],
      { failover: true, onFailover: (from, to, reason) => switches.push([from, to, reason]) },
    );
    expect(await chain.fetchNewPosts(['a_demo'], { limit: 100 })).toEqual(OK);
    expect(await chain.fetchNewPosts(['b_demo'], { limit: 100 })).toEqual(OK);
    expect(session.calls).toEqual([['a_demo']]);
    expect(rss.calls).toEqual([['a_demo'], ['b_demo']]);
    expect(chain.active()).toBe('rss');
    expect(chain.maxSubredditsPerRequest).toBe(5);
    expect(switches).toEqual([['session', 'rss', 'Reddit asked to sign in again']]);
  });

  it('keeps ordinary failures with the source that had them', async () => {
    const session = source([{ ok: false, kind: 'gone', message: 'Not found' }]);
    const rss = source([OK]);
    const chain = createSourceChain(
      [
        { id: 'session', source: session.value },
        { id: 'rss', source: rss.value },
      ],
      { failover: true },
    );
    expect(await chain.fetchNewPosts(['gone_demo'], { limit: 100 })).toMatchObject({
      kind: 'gone',
    });
    expect(rss.calls).toEqual([]);
  });

  it('does not switch when failover is off, and reports when no source is left', async () => {
    const failing: FetchResult = { ok: false, kind: 'blocked', message: 'Blocked' };
    const off = createSourceChain([{ id: 'rss', source: source([failing]).value }], {
      failover: false,
    });
    expect(await off.fetchNewPosts(['a_demo'], { limit: 100 })).toEqual(failing);
    const last = createSourceChain([{ id: 'rss', source: source([failing]).value }], {
      failover: true,
    });
    expect(await last.fetchNewPosts(['a_demo'], { limit: 100 })).toEqual(failing);
    const empty = createSourceChain([], { failover: true });
    expect(await empty.fetchNewPosts(['a_demo'], { limit: 100 })).toMatchObject({
      ok: false,
      kind: 'auth',
    });
  });
});
