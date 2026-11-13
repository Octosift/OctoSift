import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { subreddits } from '../db/schema';
import { getSubreddit, rulesSummaryOf, setPromotionPolicy } from '../db/queries/subreddits';
import { fakeAiClient } from '../testing/fake-ai';
import { policyFromRules, storeRules, summariseRules } from './rules';

const RULES = [
  '1. Be kind and helpful.',
  '2. No self-promotion outside the weekly thread.',
  '3. No links to your own products or services.',
].join('\n');

describe('summariseRules', () => {
  it('asks the model for a summary, with the rules fenced as untrusted text', async () => {
    const { ai, generator } = fakeAiClient(() => ({
      output: {
        promotion: 'restricted',
        links: 'forbidden',
        notes: ['Promotion only in the weekly thread', 'No links to your own products'],
      },
    }));
    const result = await summariseRules(ai, { subreddit: 'freelance_demo', text: RULES });
    expect(result).toEqual({
      ok: true,
      summary: {
        promotion: 'restricted',
        links: 'forbidden',
        notes: ['Promotion only in the weekly thread', 'No links to your own products'],
      },
    });
    const call = generator.calls[0];
    expect(call?.task).toBe('rules');
    expect(call?.system).toContain('r/freelance_demo');
    expect(call?.prompt).toContain('No self-promotion outside the weekly thread.');
  });

  it('keeps at most six notes', async () => {
    const notes = Array.from({ length: 9 }, (_, index) => `Rule ${String(index + 1)}`);
    const { ai } = fakeAiClient(() => ({
      output: { promotion: 'unclear', links: 'unclear', notes },
    }));
    const result = await summariseRules(ai, { subreddit: 'freelance_demo', text: RULES });
    expect(result.ok && result.summary.notes).toHaveLength(6);
  });

  it('reports a model failure', async () => {
    const { ai } = fakeAiClient(() => ({ fail: 'provider_error', message: 'provider down' }));
    expect(await summariseRules(ai, { subreddit: 'freelance_demo', text: RULES })).toEqual({
      ok: false,
      message: expect.stringContaining('provider down') as string,
    });
  });
});

describe('storeRules', () => {
  const summary = (promotion: 'allowed' | 'restricted' | 'forbidden' | 'unclear') => ({
    promotion,
    links: 'forbidden' as const,
    notes: ['Be kind'],
  });

  it('maps clear promotion rules to a policy and leaves unclear ones alone', () => {
    expect(policyFromRules(summary('forbidden'))).toBe('no_promotion');
    expect(policyFromRules(summary('allowed'))).toBe('allowed');
    expect(policyFromRules(summary('restricted'))).toBeNull();
    expect(policyFromRules(summary('unclear'))).toBeNull();
  });

  it('saves the text and summary and sets the policy while the user has not chosen one', () => {
    const db = openMemoryDatabase();
    db.insert(subreddits).values({ name: 'freelance_demo', createdAt: 100 }).run();
    storeRules(db, {
      subreddit: 'freelance_demo',
      text: RULES,
      summary: summary('forbidden'),
      now: 200,
    });
    const row = getSubreddit(db, 'freelance_demo');
    expect(row).toMatchObject({ rulesText: RULES, rulesUpdatedAt: 200 });
    expect(row?.promotionPolicy).toBe('no_promotion');
    expect(rulesSummaryOf(row)).toEqual(summary('forbidden'));
  });

  it('never overrides a policy the user chose', () => {
    const db = openMemoryDatabase();
    db.insert(subreddits).values({ name: 'freelance_demo', createdAt: 100 }).run();
    setPromotionPolicy(db, 'freelance_demo', 'allowed');
    storeRules(db, {
      subreddit: 'freelance_demo',
      text: RULES,
      summary: summary('forbidden'),
      now: 200,
    });
    expect(getSubreddit(db, 'freelance_demo')?.promotionPolicy).toBe('allowed');
  });
});
