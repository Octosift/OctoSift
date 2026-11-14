import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { insertProduct } from '../db/queries/products';
import { leads, posts } from '../db/schema';
import { loadSampleProduct } from '../demo/sample-products';
import { silentLogger } from '../log';
import type { ProviderAnswer } from '../reddit/provider/vendor';
import {
  hiddenReplySubreddits,
  parseCommentLink,
  replyChecksFor,
  runDueReplyChecks,
  scheduleReplyChecks,
} from './visibility';

const NOW = 1_800_000_000;
const fixture = (name: string): unknown =>
  (
    JSON.parse(
      readFileSync(resolve(process.cwd(), 'fixtures/provider', `${name}.json`), 'utf8'),
    ) as {
      data: unknown;
    }
  ).data;

function setup() {
  const db = openMemoryDatabase();
  insertProduct(db, { id: 'p1', profile: loadSampleProduct('acme-invoices'), now: NOW });
  const addLead = (id: string, subreddit: string) => {
    db.insert(posts)
      .values({
        id: `t3_${id}`,
        subreddit,
        author: 'demo_user_01',
        title: 'Synthetic post',
        bodyText: 'Synthetic body',
        url: `https://www.reddit.com/r/${subreddit}/comments/${id}/x/`,
        createdAt: NOW - 3600,
        fetchedAt: NOW - 3600,
        contentHash: id,
      })
      .run();
    db.insert(leads)
      .values({
        id: `lead-${id}`,
        productId: 'p1',
        postId: `t3_${id}`,
        kind: 'opportunity',
        score: 80,
        modelScore: 80,
        fit: 'direct',
        intent: 'asking_for_recommendation',
        reason: 'Synthetic',
        evidenceQuote: '',
        riskFlagsJson: [],
        mentionOk: true,
        dmOk: false,
        suggestedAngle: '',
        status: 'replied',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
  };
  return { db, addLead };
}

const answer = (data: unknown): ProviderAnswer => ({ ok: true, data });

describe('comment links', () => {
  it.each([
    'https://www.reddit.com/r/freelance_demo/comments/prv001/synthetic_post/cmt001/',
    'https://old.reddit.com/r/Freelance_Demo/comments/PRV001/synthetic_post/cmt001',
    'https://www.reddit.com/r/freelance_demo/comments/prv001/comment/cmt001/',
  ])('reads %s', (url) => {
    expect(parseCommentLink(url)).toEqual({
      subreddit: 'freelance_demo',
      postId: 't3_prv001',
      commentId: 't1_cmt001',
    });
  });

  it.each([
    'https://www.reddit.com/r/freelance_demo/comments/prv001/synthetic_post/',
    'https://example.com/r/freelance_demo/comments/prv001/x/cmt001/',
    'not a link',
  ])('refuses %s', (url) => {
    expect(parseCommentLink(url)).toBeNull();
  });
});

describe('reply checks', () => {
  it('schedules checks one hour and one day after the reply', () => {
    const { db, addLead } = setup();
    addLead('prv001', 'freelance_demo');
    const url = 'https://www.reddit.com/r/freelance_demo/comments/prv001/x/cmt001/';
    expect(scheduleReplyChecks(db, { leadId: 'lead-prv001', commentUrl: url, now: NOW })).toBe(
      true,
    );
    expect(replyChecksFor(db, 'lead-prv001').map((check) => [check.kind, check.dueAt])).toEqual([
      ['1h', NOW + 3600],
      ['24h', NOW + 86_400],
    ]);
    expect(scheduleReplyChecks(db, { leadId: 'lead-prv001', commentUrl: 'nope', now: NOW })).toBe(
      false,
    );
  });

  it('records visible, hidden and post gone, only for checks that are due', async () => {
    const { db, addLead } = setup();
    for (const id of ['prv001', 'prv002', 'prv003']) addLead(id, 'freelance_demo');
    const link = (post: string, comment: string) =>
      `https://www.reddit.com/r/freelance_demo/comments/${post}/x/${comment}/`;
    scheduleReplyChecks(db, {
      leadId: 'lead-prv001',
      commentUrl: link('prv001', 'cmt001'),
      now: NOW,
    });
    scheduleReplyChecks(db, {
      leadId: 'lead-prv002',
      commentUrl: link('prv002', 'cmt999'),
      now: NOW,
    });
    scheduleReplyChecks(db, {
      leadId: 'lead-prv003',
      commentUrl: link('prv003', 'cmt003'),
      now: NOW,
    });
    const asked: string[] = [];
    const provider = {
      fetchComments: (postId: string) => {
        asked.push(postId);
        return Promise.resolve(
          answer(postId === 't3_prv003' ? fixture('comments-post-gone') : fixture('comments')),
        );
      },
    };
    const deps = { db, provider, log: silentLogger() };
    expect(await runDueReplyChecks({ ...deps, now: NOW + 60 })).toBe(0);
    expect(await runDueReplyChecks({ ...deps, now: NOW + 3700 })).toBe(3);
    const firstResults = (leadId: string) => replyChecksFor(db, leadId)[0]?.result;
    expect(firstResults('lead-prv001')).toBe('visible');
    expect(firstResults('lead-prv002')).toBe('hidden');
    expect(firstResults('lead-prv003')).toBe('post_gone');
    expect(asked).toEqual(['t3_prv001', 't3_prv002', 't3_prv003']);
  });

  it('stops when the provider key or the budget fails, leaving checks for later', async () => {
    const { db, addLead } = setup();
    for (const id of ['prv001', 'prv002']) addLead(id, 'freelance_demo');
    for (const id of ['prv001', 'prv002']) {
      scheduleReplyChecks(db, {
        leadId: `lead-${id}`,
        commentUrl: `https://www.reddit.com/r/freelance_demo/comments/${id}/x/cmt001/`,
        now: NOW,
      });
    }
    let calls = 0;
    const provider = {
      fetchComments: () => {
        calls += 1;
        return Promise.resolve({ ok: false as const, kind: 'auth' as const, message: 'No key' });
      },
    };
    expect(await runDueReplyChecks({ db, provider, now: NOW + 3700, log: silentLogger() })).toBe(0);
    expect(calls).toBe(1);
    expect(replyChecksFor(db, 'lead-prv001')[0]?.result).toBeNull();
  });

  it('lists the subreddits with hidden replies in the last week', async () => {
    const { db, addLead } = setup();
    addLead('prv001', 'freelance_demo');
    addLead('prv002', 'smallbiz_demo');
    for (const [id, sub] of [
      ['prv001', 'freelance_demo'],
      ['prv002', 'smallbiz_demo'],
    ] as const) {
      scheduleReplyChecks(db, {
        leadId: `lead-${id}`,
        commentUrl: `https://www.reddit.com/r/${sub}/comments/${id}/x/cmt999/`,
        now: NOW,
      });
    }
    const provider = { fetchComments: () => Promise.resolve(answer(fixture('comments'))) };
    await runDueReplyChecks({ db, provider, now: NOW + 3700, log: silentLogger() });
    expect(hiddenReplySubreddits(db, NOW + 3700).sort()).toEqual([
      'freelance_demo',
      'smallbiz_demo',
    ]);
    expect(hiddenReplySubreddits(db, NOW + 9 * 86_400)).toEqual([]);
  });
});
