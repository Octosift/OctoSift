import { describe, expect, it } from 'vitest';
import {
  FITS,
  INTENTS,
  RISK_FLAGS,
  type InternalFlag,
  type QualifyResult,
  type RiskFlag,
} from '../ai/schemas';
import { seededRandom, type Random } from '../clock';
import { finalScore, freshnessFactor } from './score';
import { applyVeto, type PromotionRule, type VetoInput } from './veto';

const base: QualifyResult = {
  fit: 'direct',
  intent: 'asking_for_recommendation',
  score: 90,
  reason: 'r',
  evidenceQuote: 'q',
  mentionOk: true,
  dmOk: true,
  suggestedAngle: 'a',
  riskFlags: [],
  alternativesMentioned: [],
};

function input(
  overrides: Partial<VetoInput> = {},
  qualify: Partial<QualifyResult> = {},
): VetoInput {
  return {
    qualify: { ...base, ...qualify },
    internalFlags: [],
    postText: 'How do I chase late invoices?',
    subredditNoPromotion: false,
    rulesPromotion: null,
    vetoPhrases: [],
    ...overrides,
  };
}

describe('applyVeto', () => {
  it.each<[string, VetoInput, boolean]>([
    ['keeps a good direct fit', input(), true],
    ['drops posts with no fit', input({}, { fit: 'none' }), false],
    ['drops authors who are vendors', input({}, { riskFlags: ['author_is_vendor'] }), false],
    ['drops job ads', input({}, { intent: 'hiring_or_job_ad' }), false],
    ['drops self-promotion', input({}, { intent: 'own_promotion' }), false],
    ['drops posts matching a veto phrase', input({ vetoPhrases: ['late invoices'] }), false],
    ['keeps venting posts as leads', input({}, { riskFlags: ['venting'] }), true],
  ])('%s', (_label, veto, lead) => {
    expect(applyVeto(veto).lead).toBe(lead);
  });

  it.each<[string, VetoInput]>([
    ['the author is venting', input({}, { riskFlags: ['venting'] })],
    ['the author wants no tools', input({}, { riskFlags: ['wants_no_tools'] })],
    ['the user marked the subreddit', input({ subredditNoPromotion: true })],
    ['the rules forbid promotion', input({ rulesPromotion: 'forbidden' })],
  ])('turns product mentions off when %s', (_label, veto) => {
    const outcome = applyVeto(veto);
    expect(outcome.mentionOk).toBe(false);
    expect(outcome.dmOk).toBe(false);
  });

  it('flags subreddits that are hostile to promotion', () => {
    expect(applyVeto(input({ rulesPromotion: 'forbidden' })).flags).toContain(
      'sub_hostile_to_promotion',
    );
  });

  it('keeps mentions on when the rules only restrict promotion', () => {
    expect(applyVeto(input({ rulesPromotion: 'restricted' })).mentionOk).toBe(true);
  });

  it('explains why a post is not a lead', () => {
    expect(applyVeto(input({}, { fit: 'none' })).reasons).toEqual([
      'The product would not help with what the author wants',
    ]);
  });
});

describe('finalScore', () => {
  it.each<[number, number]>([
    [1, 1],
    [5.9, 1],
    [6, 0.9],
    [23, 0.9],
    [24, 0.75],
    [47, 0.75],
    [48, 0.5],
    [400, 0.5],
  ])('uses a freshness factor for a post %s hours old', (hours, factor) => {
    expect(freshnessFactor(hours)).toBe(factor);
  });

  it.each<[string, number, number, string[], number]>([
    ['a fresh post keeps its score', 88, 2, [], 88],
    ['a day-old post loses a quarter', 80, 30, [], 60],
    ['each penalised flag costs ten points', 90, 2, ['low_effort_post', 'sensitive_topic'], 70],
    ['an unverified quote costs twenty points', 90, 2, ['unverified_quote'], 70],
    ['other flags cost nothing', 90, 2, ['venting', 'sub_hostile_to_promotion'], 90],
    ['the score never goes below zero', 20, 100, ['low_effort_post', 'unverified_quote'], 0],
    ['a repeated flag counts once', 90, 2, ['low_effort_post', 'low_effort_post'], 80],
  ])('%s', (_label, modelScore, ageHours, flags, expected) => {
    expect(finalScore({ modelScore, ageHours, flags })).toBe(expected);
  });
});

describe('veto properties', () => {
  function pick<T>(random: Random, items: readonly T[]): T {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error('empty list');
    return item;
  }

  function randomInput(random: Random): VetoInput {
    const riskFlags: RiskFlag[] = RISK_FLAGS.filter(() => random() < 0.2);
    const internalFlags: InternalFlag[] = random() < 0.3 ? ['unverified_quote'] : [];
    const promotion: (PromotionRule | null)[] = [
      'allowed',
      'restricted',
      'forbidden',
      'unclear',
      null,
    ];
    return input(
      {
        internalFlags,
        subredditNoPromotion: random() < 0.2,
        rulesPromotion: pick(random, promotion),
        vetoPhrases: random() < 0.2 ? ['invoices'] : [],
      },
      {
        fit: pick(random, FITS),
        intent: pick(random, INTENTS),
        score: Math.floor(random() * 101),
        mentionOk: random() < 0.7,
        dmOk: random() < 0.3,
        riskFlags,
      },
    );
  }

  it('never raises a score, a lead, a mention or a private message', () => {
    const random = seededRandom(20261113);
    for (let iteration = 0; iteration < 1_000; iteration += 1) {
      const veto = randomInput(random);
      const outcome = applyVeto(veto);
      const ageHours = random() * 72;
      const before = finalScore({
        modelScore: veto.qualify.score,
        ageHours,
        flags: [...veto.qualify.riskFlags, ...veto.internalFlags],
      });
      const after = finalScore({ modelScore: veto.qualify.score, ageHours, flags: outcome.flags });
      expect(after).toBeLessThanOrEqual(before);
      if (outcome.mentionOk) expect(veto.qualify.mentionOk).toBe(true);
      if (outcome.dmOk) expect(veto.qualify.dmOk).toBe(true);
      if (outcome.lead) expect(veto.qualify.fit).not.toBe('none');
      for (const flag of [...veto.qualify.riskFlags, ...veto.internalFlags]) {
        expect(outcome.flags).toContain(flag);
      }
    }
  });
});
