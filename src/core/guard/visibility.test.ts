import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { insertProduct } from '../db/queries/products';
import { leads, posts } from '../db/schema';
import { loadSampleProduct } from '../demo/sample-products';
import { silentLogger } from '../log';
import type { SessionResponse } from '../reddit/session-client';
import {
  judgeThread,
  parseCommentLink,
  removedReplySubreddits,
  replyChecksFor,
  runDueReplyChecks,
  scheduleReplyChecks,
} from './visibility';

const NOW = 1_800_000_000;
const HOUR = 3600;
const PATH = '/r/freelance_demo/comments/rpl001/how_do_you_get_clients_to_pay/cmt001/';
const LINK = `https://www.reddit.com${PATH}`;

type Thread = [
  { data: { children: { kind: string; data: Record<string, unknown> }[] } },
  { data: { children: { kind: string; data: Record<string, unknown> }[] } },
];

/** The synthetic thread, changed by `edit` for one case. */
function thread(edit: (value: Thread) => void = () => undefined): Thread {
  const value = JSON.parse(
    readFileSync(resolve(process.cwd(), 'fixtures/session/comment-thread.json'), 'utf8'),
  ) as Thread;
  edit(value);
  return value;
}
const comment = (value: Thread) => value[1].data.children[0]?.data ?? {};
const post = (value: Thread) => value[0].data.children[0]?.data ?? {};

function setup() {
  const db = openMemoryDatabase();
  insertProduct(db, { id: 'p1', profile: loadSampleProduct('acme-invoices'), now: NOW });
  const addLead = (id: string, subreddit: string) => {
    db.insert(posts)
      .values({
        id: `t3_${id}`,
        subreddit,
        author: 'demo_user_04',
        title: 'Synthetic post',
        bodyText: 'Synthetic body',
        url: `https://www.reddit.com/r/${subreddit}/comments/${id}/x/`,
        createdAt: NOW - HOUR,
        fetchedAt: NOW - HOUR,
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

/** A fake session client answering by path prefix; records every path. */
function reddit(answer: (path: string) => SessionResponse) {
  const paths: string[] = [];
  return {
    paths,
    getJson: (path: string) => {
      paths.push(path);
      return Promise.resolve(answer(path));
    },
  };
}
const ok = (json: unknown): SessionResponse => ({ ok: true, json });

describe('comment links', () => {
  it.each([
    [LINK, PATH],
    [
      'https://old.reddit.com/r/Freelance_Demo/comments/RPL001/how_do_you_get_clients_to_pay/CMT001',
      '/r/Freelance_Demo/comments/rpl001/how_do_you_get_clients_to_pay/cmt001/',
    ],
    [
      'https://www.reddit.com/r/freelance_demo/comments/rpl001/comment/cmt001/?context=3',
      '/r/freelance_demo/comments/rpl001/comment/cmt001/',
    ],
  ])('reads %s', (url, path) => {
    expect(parseCommentLink(url)).toEqual({
      subreddit: 'freelance_demo',
      postId: 't3_rpl001',
      commentId: 't1_cmt001',
      path,
    });
  });

  it.each([
    'https://www.reddit.com/r/freelance_demo/comments/rpl001/how_do_you_get_clients_to_pay/',
    'https://example.com/r/freelance_demo/comments/rpl001/x/cmt001/',
    'not a link',
  ])('refuses %s', (url) => {
    expect(parseCommentLink(url)).toBeNull();
  });
});

describe('judging a permalink thread', () => {
  it.each([
    ['a comment others can see', thread(), 'visible'],
    [
      'a "[removed]" comment',
      thread((value) => {
        Object.assign(comment(value), { body: '[removed]', author: '[deleted]' });
      }),
      'removed',
    ],
    [
      'a comment deleted by its author',
      thread((value) => {
        Object.assign(comment(value), { body: '[deleted]', author: '[deleted]' });
      }),
      'removed',
    ],
    [
      'a comment missing from its own thread',
      thread((value) => {
        value[1].data.children = [];
      }),
      'removed',
    ],
    [
      'a post removed by moderators',
      thread((value) => {
        Object.assign(post(value), { removed_by_category: 'moderator', selftext: '[removed]' });
      }),
      'post_gone',
    ],
    [
      'a post deleted by its author',
      thread((value) => {
        Object.assign(post(value), { selftext: '[deleted]', author: '[deleted]' });
      }),
      'post_gone',
    ],
  ])('reports %s', (_, json, expected) => {
    expect(judgeThread(json, 't1_cmt001', 'demo_reader')).toBe(expected);
  });

  it('finds the comment among replies too', () => {
    expect(judgeThread(thread(), 't1_cmt002', 'demo_reader')).toBe('visible');
  });

  it('cannot tell for a reply posted from the connected account itself', () => {
    expect(judgeThread(thread(), 't1_cmt001', 'Demo_Founder')).toBe('unknown');
  });

  it('refuses an answer that is not a thread', () => {
    expect(judgeThread({ kind: 'Listing', data: { children: [] } }, 't1_cmt001', null)).toBeNull();
  });
});

describe('reply checks', () => {
  it('schedules checks one hour and one day after the reply', () => {
    const { db, addLead } = setup();
    addLead('rpl001', 'freelance_demo');
    expect(scheduleReplyChecks(db, { leadId: 'lead-rpl001', commentUrl: LINK, now: NOW })).toBe(
      true,
    );
    expect(replyChecksFor(db, 'lead-rpl001').map((check) => [check.kind, check.dueAt])).toEqual([
      ['1h', NOW + HOUR],
      ['24h', NOW + 24 * HOUR],
    ]);
    expect(scheduleReplyChecks(db, { leadId: 'lead-rpl001', commentUrl: 'nope', now: NOW })).toBe(
      false,
    );
  });

  it('reads each due comment through its own permalink and records the result', async () => {
    const { db, addLead } = setup();
    for (const id of ['rpl001', 'rpl002', 'rpl003']) {
      addLead(id, 'freelance_demo');
      scheduleReplyChecks(db, {
        leadId: `lead-${id}`,
        commentUrl: `https://www.reddit.com/r/freelance_demo/comments/${id}/a_post/cmt001/`,
        now: NOW,
      });
    }
    const client = reddit((path) => {
      if (path.includes('rpl002')) {
        return ok(
          thread((value) => {
            Object.assign(comment(value), { body: '[removed]' });
          }),
        );
      }
      if (path.includes('rpl003')) return { ok: false, kind: 'gone', status: 404, message: 'x' };
      return ok(thread());
    });
    const deps = { db, reddit: client, account: 'demo_reader', log: silentLogger() };
    expect(await runDueReplyChecks({ ...deps, now: NOW + 60 })).toBe(0);
    expect(client.paths).toEqual([]);
    expect(await runDueReplyChecks({ ...deps, now: NOW + HOUR + 60 })).toBe(3);
    const first = (leadId: string) => replyChecksFor(db, leadId)[0]?.result;
    expect(first('lead-rpl001')).toBe('visible');
    expect(first('lead-rpl002')).toBe('removed');
    expect(first('lead-rpl003')).toBe('post_gone');
    expect(client.paths).toEqual([
      '/r/freelance_demo/comments/rpl001/a_post/cmt001/.json?raw_json=1',
      '/r/freelance_demo/comments/rpl002/a_post/cmt001/.json?raw_json=1',
      '/r/freelance_demo/comments/rpl003/a_post/cmt001/.json?raw_json=1',
    ]);
  });

  it('treats a private or banned subreddit as the post being gone', async () => {
    const { db, addLead } = setup();
    addLead('rpl001', 'freelance_demo');
    scheduleReplyChecks(db, { leadId: 'lead-rpl001', commentUrl: LINK, now: NOW });
    const client = reddit(() => ({
      ok: false,
      kind: 'gone',
      status: 403,
      message: 'The subreddit is private',
    }));
    await runDueReplyChecks({
      db,
      reddit: client,
      account: null,
      now: NOW + HOUR,
      log: silentLogger(),
    });
    expect(replyChecksFor(db, 'lead-rpl001')[0]?.result).toBe('post_gone');
  });

  it('stops when the session needs reconnecting or its hourly allowance is used', async () => {
    const { db, addLead } = setup();
    for (const id of ['rpl001', 'rpl002']) {
      addLead(id, 'freelance_demo');
      scheduleReplyChecks(db, {
        leadId: `lead-${id}`,
        commentUrl: `https://www.reddit.com/r/freelance_demo/comments/${id}/a_post/cmt001/`,
        now: NOW,
      });
    }
    for (const failure of [
      { ok: false, kind: 'auth', message: 'Reddit refused the session (HTTP 401)' },
      { ok: false, kind: 'rate_limited', message: 'Hourly request limit reached' },
    ] as const) {
      const client = reddit(() => failure);
      expect(
        await runDueReplyChecks({
          db,
          reddit: client,
          account: null,
          now: NOW + HOUR,
          log: silentLogger(),
        }),
      ).toBe(0);
      expect(client.paths).toHaveLength(1);
    }
    expect(replyChecksFor(db, 'lead-rpl001')[0]).toMatchObject({ result: null, attempts: 0 });
  });

  it('retries other failures half an hour later, then gives up as unknown', async () => {
    const { db, addLead } = setup();
    addLead('rpl001', 'freelance_demo');
    scheduleReplyChecks(db, { leadId: 'lead-rpl001', commentUrl: LINK, now: NOW });
    const client = reddit(() => ({
      ok: false,
      kind: 'network',
      message: 'Reddit sent a web page instead of data',
    }));
    const deps = { db, reddit: client, account: null, log: silentLogger() };
    let now = NOW + HOUR;
    await runDueReplyChecks({ ...deps, now });
    expect(replyChecksFor(db, 'lead-rpl001')[0]).toMatchObject({
      result: null,
      attempts: 1,
      dueAt: now + 1800,
    });
    await runDueReplyChecks({ ...deps, now: now + 60 });
    expect(client.paths).toHaveLength(1);
    now += 1800;
    await runDueReplyChecks({ ...deps, now });
    now += 1800;
    await runDueReplyChecks({ ...deps, now });
    expect(replyChecksFor(db, 'lead-rpl001')[0]).toMatchObject({ result: 'unknown', attempts: 3 });
    expect(client.paths).toHaveLength(3);
  });

  it('lists the subreddits with removed replies in the last week', async () => {
    const { db, addLead } = setup();
    for (const [id, sub] of [
      ['rpl001', 'freelance_demo'],
      ['rpl002', 'smallbiz_demo'],
    ] as const) {
      addLead(id, sub);
      scheduleReplyChecks(db, {
        leadId: `lead-${id}`,
        commentUrl: `https://www.reddit.com/r/${sub}/comments/${id}/a_post/cmt999/`,
        now: NOW,
      });
    }
    const client = reddit(() => ok(thread()));
    await runDueReplyChecks({
      db,
      reddit: client,
      account: null,
      now: NOW + HOUR,
      log: silentLogger(),
    });
    expect(removedReplySubreddits(db, NOW + HOUR).sort()).toEqual([
      'freelance_demo',
      'smallbiz_demo',
    ]);
    expect(removedReplySubreddits(db, NOW + 9 * 86_400)).toEqual([]);
  });
});
