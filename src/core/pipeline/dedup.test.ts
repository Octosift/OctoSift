import { describe, expect, it } from 'vitest';
import {
  contentHash,
  findCrossposts,
  normalizeForHash,
  resumeStage,
  type HashedPost,
  type StageRecord,
} from './dedup';

describe('normalizeForHash', () => {
  it('lower-cases, strips punctuation and collapses whitespace', () => {
    expect(normalizeForHash('  How do I GET paid?!\n\n  (Asking   for a friend…)  ')).toBe(
      'how do i get paid asking for a friend',
    );
  });
});

describe('contentHash', () => {
  it('ignores case, punctuation and spacing differences', () => {
    expect(contentHash('Late payments!', 'Clients pay late.  Help?')).toBe(
      contentHash('late payments', 'clients pay late help'),
    );
  });

  it('only uses the first 200 characters of the body', () => {
    const start = 'x'.repeat(200);
    expect(contentHash('t', `${start} ending one`)).toBe(contentHash('t', `${start} ending two`));
  });

  it('differs when the title differs', () => {
    expect(contentHash('one', 'body')).not.toBe(contentHash('two', 'body'));
  });
});

describe('findCrossposts', () => {
  const hash = contentHash('same title', 'same body');
  const make = (id: string, subreddit: string, createdAt: number, h = hash): HashedPost => ({
    id,
    subreddit,
    createdAt,
    contentHash: h,
  });

  it('marks the newer copy in another subreddit as a cross-post of the older one', () => {
    const result = findCrossposts([make('t3_new', 'b_demo', 200)], [make('t3_old', 'a_demo', 100)]);
    expect(result).toEqual(new Map([['t3_new', 't3_old']]));
  });

  it('finds cross-posts within one batch of new posts', () => {
    const result = findCrossposts([make('t3_b', 'b_demo', 200), make('t3_a', 'a_demo', 100)], []);
    expect(result).toEqual(new Map([['t3_b', 't3_a']]));
  });

  it('does not treat a repost in the same subreddit as a cross-post', () => {
    expect(
      findCrossposts([make('t3_new', 'a_demo', 200)], [make('t3_old', 'a_demo', 100)]).size,
    ).toBe(0);
  });

  it('ignores posts with different content', () => {
    const other = contentHash('other', 'post');
    expect(
      findCrossposts([make('t3_new', 'b_demo', 200, other)], [make('t3_old', 'a_demo', 100)]).size,
    ).toBe(0);
  });
});

describe('resumeStage', () => {
  const row = (
    stage: StageRecord['stage'],
    verdict: StageRecord['verdict'],
    reason = 'r',
  ): StageRecord => ({
    stage,
    verdict,
    reason,
  });

  it.each<[string, StageRecord[], ReturnType<typeof resumeStage>]>([
    ['a post never seen', [], 'prefilter'],
    ['a post skipped by the prefilter', [row('prefilter', 'skip')], 'done'],
    ['a brand mention', [row('prefilter', 'pass', 'brand_mention')], 'done'],
    ['a post waiting for triage', [row('prefilter', 'pass')], 'triage'],
    ['a post whose triage failed', [row('prefilter', 'pass'), row('triage', 'error')], 'triage'],
    ['a post triage skipped', [row('prefilter', 'pass'), row('triage', 'skip')], 'done'],
    [
      'a post waiting for qualification',
      [row('prefilter', 'pass'), row('triage', 'pass')],
      'qualify',
    ],
    [
      'a post whose qualification failed',
      [row('prefilter', 'pass'), row('triage', 'pass'), row('qualify', 'error')],
      'qualify',
    ],
    [
      'a fully evaluated post',
      [
        row('prefilter', 'pass'),
        row('triage', 'pass'),
        row('qualify', 'pass'),
        row('veto', 'skip'),
      ],
      'done',
    ],
  ])('resumes %s at the right stage', (_label, rows, expected) => {
    expect(resumeStage(rows)).toBe(expected);
  });
});
