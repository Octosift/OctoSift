import { describe, expect, it } from 'vitest';
import {
  clip,
  normalizeQualify,
  normalizeSubredditSuggestions,
  normalizeTriage,
  qualifyWire,
} from './schemas';

describe('clip', () => {
  it('leaves short text alone and shortens long text with an ellipsis', () => {
    expect(clip('  short  ', 10)).toBe('short');
    const clipped = clip('a'.repeat(50), 10);
    expect(clipped).toHaveLength(10);
    expect(clipped.endsWith('…')).toBe(true);
  });

  it('ends on a whole sentence when one ends late enough', () => {
    const text = 'The reply answers the question well. However, the mention reads like an advert.';
    expect(clip(text, 55)).toBe('The reply answers the question well.');
  });

  it('otherwise ends on a whole word', () => {
    const text =
      'The unsolicited mention makes the comment promotional, especially with the subreddit';
    const clipped = clip(text, 70);
    expect(clipped).toBe('The unsolicited mention makes the comment promotional, especially…');
    expect(clipped.length).toBeLessThanOrEqual(70);
  });
});

describe('normalizeTriage', () => {
  it('shortens reasons to 120 characters', () => {
    const [result] = normalizeTriage({
      results: [{ id: 't3_a', relevant: true, why: 'x'.repeat(300) }],
    });
    expect(result?.why.length).toBe(120);
  });
});

describe('normalizeQualify', () => {
  const raw = qualifyWire.parse({
    fit: 'direct',
    intent: 'asking_for_recommendation',
    score: 104.6,
    reason: 'r'.repeat(400),
    evidence_quote: 'quote',
    mention_ok: true,
    dm_ok: false,
    suggested_angle: 'angle',
    risk_flags: ['venting', 'venting'],
    alternatives_mentioned: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  });

  it('clamps the score to a whole number between 0 and 100', () => {
    expect(normalizeQualify(raw).score).toBe(100);
    expect(normalizeQualify({ ...raw, score: -3 }).score).toBe(0);
  });

  it('applies the length and count limits', () => {
    const result = normalizeQualify(raw);
    expect(result.reason.length).toBe(240);
    expect(result.alternativesMentioned).toHaveLength(5);
    expect(result.riskFlags).toEqual(['venting']);
  });

  it('rejects unknown risk flags at the wire level', () => {
    expect(qualifyWire.safeParse({ ...raw, risk_flags: ['made_up'] }).success).toBe(false);
  });
});

describe('normalizeSubredditSuggestions', () => {
  it('normalises names, drops invalid and duplicate names, and caps the count', () => {
    const result = normalizeSubredditSuggestions(
      {
        suggestions: [
          { name: 'r/Freelance_Demo', reason: 'freelancers', promotion_strictness: 'strict' },
          { name: 'freelance_demo', reason: 'again', promotion_strictness: 'strict' },
          { name: 'not a name', reason: 'bad', promotion_strictness: 'unknown' },
          { name: 'smallbiz_demo', reason: 'owners', promotion_strictness: 'moderate' },
        ],
      },
      1,
    );
    expect(result).toEqual([
      { name: 'freelance_demo', reason: 'freelancers', promotionStrictness: 'strict' },
    ]);
  });
});
