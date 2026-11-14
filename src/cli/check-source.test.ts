import { describe, expect, it } from 'vitest';
import { createSourceChain } from '../core/reddit/chain';
import type { FetchOptions, FetchResult, RedditSource } from '../core/reddit/types';
import { parseCheckSourceArgs, runCheckSource } from './check-source';

const NOW = 1_800_000_000;

function source(result: FetchResult) {
  const calls: { names: string[]; opts: FetchOptions }[] = [];
  const value: RedditSource = {
    fetchNewPosts: (names, opts) => {
      calls.push({ names, opts });
      return Promise.resolve(result);
    },
  };
  return { calls, value };
}

const post = (minutesAgo: number) => ({
  id: `t3_c${String(minutesAgo)}`,
  subreddit: 'freelance_demo',
  author: 'demo_user_01',
  title: 'Synthetic post',
  bodyText: '',
  bodyLinks: [],
  url: 'https://www.reddit.com/r/freelance_demo/comments/c1/x/',
  imageUrl: null,
  createdAt: NOW - minutesAgo * 60,
  archived: false,
});

describe('check-source', () => {
  it('reads one page of the first watched subreddit and reports the source used', async () => {
    const ok = source({
      ok: true,
      posts: [post(12), post(40)],
      rate: { used: null, remaining: null, resetS: null },
    });
    const chain = createSourceChain([{ id: 'provider', source: ok.value }], { failover: true });
    const result = await runCheckSource(
      { source: chain, watched: ['freelance_demo'], now: NOW },
      null,
    );
    expect(result).toEqual({
      code: 0,
      output: 'Source: data provider\nr/freelance_demo: ok, 2 posts, newest 12 minutes old\n',
    });
    expect(ok.calls).toEqual([{ names: ['freelance_demo'], opts: { limit: 25, maxPages: 1 } }]);
  });

  it('says when it fell back from the preferred source', async () => {
    const failing = source({ ok: false, kind: 'auth', message: 'Reddit asked to sign in again' });
    const rss = source({
      ok: true,
      posts: [],
      rate: { used: null, remaining: null, resetS: null },
    });
    const chain = createSourceChain(
      [
        { id: 'session', source: failing.value },
        { id: 'rss', source: rss.value },
      ],
      { failover: true },
    );
    const result = await runCheckSource({ source: chain, watched: [], now: NOW }, 'smallbiz_demo');
    expect(result.output).toBe(
      'Source: public RSS feeds (after Reddit account failed)\nr/smallbiz_demo: ok, 0 posts\n',
    );
  });

  it('reports a failure with its reason and a non-zero exit code', async () => {
    const failing = source({ ok: false, kind: 'auth', message: 'No data provider key is set' });
    const chain = createSourceChain([{ id: 'provider', source: failing.value }], {
      failover: false,
    });
    expect(await runCheckSource({ source: chain, watched: ['a_demo'], now: NOW }, null)).toEqual({
      code: 1,
      output: 'Source: data provider\nr/a_demo: failed (auth): No data provider key is set\n',
    });
  });

  it('parses an optional subreddit name', async () => {
    expect(parseCheckSourceArgs([])).toEqual({ ok: true, subreddit: null });
    expect(parseCheckSourceArgs(['r/Freelance'])).toEqual({ ok: true, subreddit: 'freelance' });
    expect(parseCheckSourceArgs(['not a name'])).toMatchObject({ ok: false });
    expect(await runCheckSourceWithoutSubreddits()).toMatchObject({ code: 2 });
  });
});

function runCheckSourceWithoutSubreddits() {
  const unused = source({
    ok: true,
    posts: [],
    rate: { used: null, remaining: null, resetS: null },
  });
  return runCheckSource({ source: unused.value, watched: [], now: NOW }, null);
}
