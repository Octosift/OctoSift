import { describe, expect, it } from 'vitest';
import type { RedditPost } from './types';
import {
  dueSubreddits,
  nextPollIntervals,
  planRequests,
  selectNewPosts,
  type SubredditPollState,
} from './polling';

const NOW = 1_800_000_000;
const HOUR = 3600;

function state(name: string, overrides: Partial<SubredditPollState> = {}): SubredditPollState {
  return {
    name,
    status: 'active',
    lastPolledAt: null,
    pollIntervalMinutes: null,
    blockUntil: null,
    previousNewestAt: null,
    ...overrides,
  };
}

function post(id: string, subreddit: string, createdAt: number): RedditPost {
  return {
    id,
    subreddit,
    author: 'demo_user_01',
    title: id,
    bodyText: 'body',
    bodyLinks: [],
    url: `https://www.reddit.com/r/${subreddit}/comments/${id.slice(3)}/x/`,
    imageUrl: null,
    createdAt,
    archived: false,
  };
}

describe('dueSubreddits', () => {
  const options = { now: NOW, defaultIntervalMinutes: 60 };

  it('includes subreddits that were never polled', () => {
    expect(dueSubreddits([state('a_demo')], options).map((s) => s.name)).toEqual(['a_demo']);
  });

  it('waits for the interval to pass since the last poll', () => {
    const states = [
      state('recent_demo', { lastPolledAt: NOW - 30 * 60 }),
      state('stale_demo', { lastPolledAt: NOW - 61 * 60 }),
    ];
    expect(dueSubreddits(states, options).map((s) => s.name)).toEqual(['stale_demo']);
  });

  it('uses the shorter interval of a busy subreddit', () => {
    const states = [state('busy_demo', { lastPolledAt: NOW - 20 * 60, pollIntervalMinutes: 15 })];
    expect(dueSubreddits(states, options)).toHaveLength(1);
  });

  it('skips paused, missing and blocked subreddits', () => {
    const states = [
      state('paused_demo', { status: 'paused' }),
      state('gone_demo', { status: 'gone' }),
      state('blocked_demo', { blockUntil: NOW + 60 }),
      state('unblocked_demo', { blockUntil: NOW - 60 }),
    ];
    expect(dueSubreddits(states, options).map((s) => s.name)).toEqual(['unblocked_demo']);
  });
});

describe('planRequests', () => {
  it('groups quiet subreddits five to a request and polls busy ones alone', () => {
    const states = [
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((letter) => state(`${letter}_demo`)),
      state('busy_demo', { pollIntervalMinutes: 30 }),
    ];
    expect(planRequests(states, 5)).toEqual([
      ['busy_demo'],
      ['a_demo', 'b_demo', 'c_demo', 'd_demo', 'e_demo'],
      ['f_demo', 'g_demo'],
    ]);
  });
});

describe('nextPollIntervals', () => {
  const defaults = { limit: 4, defaultIntervalMinutes: 60, minIntervalMinutes: 15 };

  it('marks a subreddit busy and halves its interval when a full feed has no overlap', () => {
    const states = [state('busy_demo', { previousNewestAt: NOW - 10 * HOUR })];
    const posts = [1, 2, 3, 4].map((n) => post(`t3_b${n}`, 'busy_demo', NOW - n * 60));
    expect(nextPollIntervals({ states, posts, ...defaults })).toEqual(new Map([['busy_demo', 30]]));
  });

  it('also treats a read the source cut short as a full feed', () => {
    const states = [state('busy_demo', { previousNewestAt: NOW - 10 * HOUR })];
    const posts = [1, 2].map((n) => post(`t3_b${n}`, 'busy_demo', NOW - n * 60));
    expect(nextPollIntervals({ states, posts, ...defaults, truncated: true })).toEqual(
      new Map([['busy_demo', 30]]),
    );
    expect(nextPollIntervals({ states, posts, ...defaults }).size).toBe(0);
  });

  it('never goes below the minimum interval', () => {
    const states = [
      state('busy_demo', { previousNewestAt: NOW - 10 * HOUR, pollIntervalMinutes: 20 }),
    ];
    const posts = [1, 2, 3, 4].map((n) => post(`t3_b${n}`, 'busy_demo', NOW - n * 60));
    expect(nextPollIntervals({ states, posts, ...defaults }).get('busy_demo')).toBe(15);
  });

  it('leaves the interval alone when the feed reaches back to the previous newest post', () => {
    const states = [state('steady_demo', { previousNewestAt: NOW - 3 * 60 })];
    const posts = [1, 2, 3, 4].map((n) => post(`t3_s${n}`, 'steady_demo', NOW - n * 60));
    expect(nextPollIntervals({ states, posts, ...defaults }).size).toBe(0);
  });

  it('does not judge a subreddit on its first poll', () => {
    const states = [state('new_demo')];
    const posts = [1, 2, 3, 4].map((n) => post(`t3_n${n}`, 'new_demo', NOW - n * 60));
    expect(nextPollIntervals({ states, posts, ...defaults }).size).toBe(0);
  });

  it('pulls the busiest member out of a combined request that overflowed', () => {
    const states = [
      state('loud_demo', { previousNewestAt: NOW - 10 * HOUR }),
      state('quiet_demo', { previousNewestAt: NOW - 10 * HOUR }),
    ];
    const posts = [
      post('t3_l1', 'loud_demo', NOW - 60),
      post('t3_l2', 'loud_demo', NOW - 120),
      post('t3_q1', 'quiet_demo', NOW - 180),
      post('t3_l3', 'loud_demo', NOW - 240),
    ];
    expect(nextPollIntervals({ states, posts, ...defaults })).toEqual(new Map([['loud_demo', 30]]));
  });

  it('lets a busy subreddit calm down when few new posts arrive', () => {
    const states = [
      state('calm_demo', { previousNewestAt: NOW - 2 * HOUR, pollIntervalMinutes: 15 }),
    ];
    const posts = [post('t3_c1', 'calm_demo', NOW - 60)];
    expect(
      nextPollIntervals({
        states,
        posts,
        limit: 100,
        defaultIntervalMinutes: 60,
        minIntervalMinutes: 15,
      }),
    ).toEqual(new Map([['calm_demo', 30]]));
  });

  it('returns a busy subreddit to the default schedule once its interval is back to normal', () => {
    const states = [
      state('calm_demo', { previousNewestAt: NOW - 2 * HOUR, pollIntervalMinutes: 30 }),
    ];
    const posts = [post('t3_c1', 'calm_demo', NOW - 60)];
    expect(
      nextPollIntervals({
        states,
        posts,
        limit: 100,
        defaultIntervalMinutes: 60,
        minIntervalMinutes: 15,
      }),
    ).toEqual(new Map([['calm_demo', null]]));
  });
});

describe('selectNewPosts', () => {
  it('stops reading a subreddit at the first post already stored', () => {
    const posts = [
      post('t3_new2', 'a_demo', NOW - 60),
      post('t3_other', 'b_demo', NOW - 90),
      post('t3_known', 'a_demo', NOW - 120),
      post('t3_older', 'a_demo', NOW - 180),
      post('t3_other2', 'b_demo', NOW - 200),
    ];
    const selected = selectNewPosts(posts, {
      knownIds: new Set(['t3_known']),
      firstPoll: new Set(),
      now: NOW,
      firstPollWindowS: 48 * HOUR,
    });
    expect(selected.map((p) => p.id)).toEqual(['t3_new2', 't3_other', 't3_other2']);
  });

  it('keeps only recent posts on the first poll of a subreddit', () => {
    const posts = [
      post('t3_recent', 'a_demo', NOW - HOUR),
      post('t3_old', 'a_demo', NOW - 49 * HOUR),
    ];
    const selected = selectNewPosts(posts, {
      knownIds: new Set(),
      firstPoll: new Set(['a_demo']),
      now: NOW,
      firstPollWindowS: 48 * HOUR,
    });
    expect(selected.map((p) => p.id)).toEqual(['t3_recent']);
  });
});
