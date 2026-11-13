import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { insertLead } from '../db/queries/leads';
import { insertPosts } from '../db/queries/posts';
import { insertProduct } from '../db/queries/products';
import { loadSampleProduct } from '../testing/sample-products';
import { pacingWarnings, recentReplies, type PastReply } from './pacing';

const NOW = 1_800_000_000;
const DAY = 24 * 3600;

const mention = (subreddit: string, daysAgo: number): PastReply => ({
  subreddit,
  repliedAt: NOW - daysAgo * DAY,
  mentionedProduct: true,
});
const helpful = (daysAgo: number): PastReply => ({
  subreddit: 'other_demo',
  repliedAt: NOW - daysAgo * DAY,
  mentionedProduct: false,
});
const helpfulHistory = Array.from({ length: 12 }, (_, index) => helpful(1 + index * 0.5));

function rules(replies: PastReply[], mentionsProduct = true, subreddit = 'freelance_demo') {
  return pacingWarnings({ replies, subreddit, mentionsProduct, now: NOW }).map((w) => w.rule);
}

describe('pacingWarnings', () => {
  it('never warns about a helpful-only reply', () => {
    expect(rules([mention('freelance_demo', 0.1)], false)).toEqual([]);
  });

  it('is quiet for a mention backed by plenty of helpful replies', () => {
    expect(rules(helpfulHistory)).toEqual([]);
  });

  it('warns about a second mention in the same subreddit within a week', () => {
    expect(rules([...helpfulHistory, mention('freelance_demo', 6)])).toContain('same_subreddit');
    expect(rules([...helpfulHistory, mention('freelance_demo', 8)])).not.toContain(
      'same_subreddit',
    );
    expect(rules([...helpfulHistory, mention('smallbiz_demo', 1)])).not.toContain('same_subreddit');
  });

  it('warns about a fourth mention within a day', () => {
    const today = [mention('a_demo', 0.1), mention('b_demo', 0.2), mention('c_demo', 0.3)];
    expect(rules([...helpfulHistory, ...helpfulHistory, ...today])).toContain('daily_mentions');
  });

  it('warns when there are fewer than three helpful replies per mention', () => {
    expect(rules([helpful(1), helpful(2)])).toEqual(['helpful_ratio']);
    expect(rules([helpful(1), helpful(2), helpful(3)])).toEqual([]);
  });

  it('only counts the last two weeks for the helpful ratio', () => {
    expect(rules([helpful(15), helpful(16), helpful(17)])).toEqual(['helpful_ratio']);
  });
});

describe('recentReplies', () => {
  it('lists replied leads with their subreddit and whether they mentioned the product', () => {
    const db = openMemoryDatabase();
    insertProduct(db, { id: 'p1', profile: loadSampleProduct('acme-invoices'), now: NOW });
    insertPosts(db, [
      {
        id: 't3_r1',
        subreddit: 'freelance_demo',
        author: 'demo_user_01',
        title: 't',
        bodyText: 'b',
        url: 'u',
        imageUrl: null,
        createdAt: NOW,
        fetchedAt: NOW,
        contentHash: 'h',
        duplicateOf: null,
      },
    ]);
    insertLead(db, {
      id: 'l1',
      productId: 'p1',
      postId: 't3_r1',
      score: 80,
      modelScore: 80,
      fit: 'direct',
      intent: 'other',
      reason: 'r',
      evidenceQuote: 'q',
      riskFlagsJson: [],
      mentionOk: true,
      dmOk: false,
      status: 'replied',
      repliedAt: NOW - DAY,
      repliedWithMention: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(recentReplies(db, NOW - 14 * DAY)).toEqual([
      { subreddit: 'freelance_demo', repliedAt: NOW - DAY, mentionedProduct: true },
    ]);
    expect(recentReplies(db, NOW)).toEqual([]);
  });
});
