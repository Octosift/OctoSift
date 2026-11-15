import { describe, expect, it } from 'vitest';
import type { DraftOutput, Fit, Intent } from '../ai/schemas';
import { seededRandom } from '../clock';
import { CONFIG } from '../config';
import type { ReplyMode } from '../db/schema';
import { fakeAiClient } from '../testing/fake-ai';
import { loadSampleProduct } from '../demo/sample-products';
import {
  checkDraft,
  chooseMode,
  countWords,
  pickVariationHint,
  writeDraft,
  type DraftCheckContext,
  type DraftRequest,
} from './draft';

const profile = loadSampleProduct('acme-invoices');

const HELPFUL =
  'Send the first reminder three days before the due date, not after it. Most late payers simply ' +
  'forget, so a short friendly note with the amount and the payment link fixes half of the cases. ' +
  'If a client is a week late, call them and ask when payment is scheduled. Put a late fee in your ' +
  'next contract so the conversation is about the contract, not about you.';

const MENTION = `${HELPFUL} I'm the maker of Acme Invoices, which sends those reminders for you.`;

function output(reply: string, mentionsProduct = false): DraftOutput {
  return { reply, mentionsProduct, includesLink: false, notesForUser: '' };
}

const context: DraftCheckContext = {
  mode: 'soft_mention',
  linksAllowed: false,
  productName: 'Acme Invoices',
  productHost: 'acme-invoices.example',
  words: CONFIG.draft.replyLengths.medium.words,
};

describe('chooseMode', () => {
  it.each<[ReplyMode, Fit, Intent, boolean, ReplyMode]>([
    ['direct', 'direct', 'asking_for_recommendation', true, 'direct'],
    ['direct', 'direct', 'describing_problem', true, 'soft_mention'],
    ['direct', 'soft', 'asking_for_recommendation', true, 'soft_mention'],
    ['direct', 'direct', 'asking_for_recommendation', false, 'helpful_only'],
    ['soft_mention', 'direct', 'asking_for_recommendation', true, 'soft_mention'],
    ['helpful_only', 'direct', 'asking_for_recommendation', true, 'helpful_only'],
  ])(
    'allowed %s, fit %s, intent %s, mention ok %s -> %s',
    (allowed, fit, intent, mentionOk, mode) => {
      expect(chooseMode({ allowed, fit, intent, mentionOk })).toBe(mode);
    },
  );
});

describe('pickVariationHint', () => {
  it('picks the same hint for the same seed, from the configured list', () => {
    const first = pickVariationHint(seededRandom(7));
    expect(first).toBe(pickVariationHint(seededRandom(7)));
    expect(CONFIG.draft.variationHints).toContain(first);
  });

  it('spreads its picks across the list', () => {
    const random = seededRandom(1);
    const picked = new Set(Array.from({ length: 200 }, () => pickVariationHint(random)));
    expect(picked.size).toBe(CONFIG.draft.variationHints.length);
  });
});

describe('checkDraft', () => {
  it('passes a helpful reply that discloses the product', () => {
    expect(checkDraft(output(MENTION, true), context)).toEqual([]);
  });

  it('passes a helpful-only reply that never mentions the product', () => {
    expect(checkDraft(output(HELPFUL), { ...context, mode: 'helpful_only' })).toEqual([]);
  });

  it.each<[string, DraftOutput, Partial<DraftCheckContext>, RegExp]>([
    ['a refusal', output(`I can't help with that. ${HELPFUL}`), {}, /refuse/],
    ['an em dash', output(HELPFUL.replace('date, not', 'date — not')), {}, /dash/],
    ['an en dash', output(HELPFUL.replace('date, not', 'date – not')), {}, /dash/],
    [
      'a link where links are not allowed',
      output(`${HELPFUL} https://example.com/guide`),
      {},
      /link/,
    ],
    [
      'the product domain where links are not allowed',
      output(`${HELPFUL} acme-invoices.example`),
      {},
      /link/,
    ],
    ['a mention without disclosure', output(`${HELPFUL} Try Acme Invoices.`), {}, /built/],
    ['a mention flagged by the model without disclosure', output(HELPFUL, true), {}, /built/],
    [
      'a mention in helpful-only mode',
      output(MENTION, true),
      { mode: 'helpful_only' },
      /Do not mention/,
    ],
    ['a reply that is too short', output('Send reminders early.'), {}, /words/],
    ['a reply that is too long', output(`${HELPFUL} `.repeat(6)), {}, /words/],
  ])('fails on %s', (_label, draft, overrides, message) => {
    const failures = checkDraft(draft, { ...context, ...overrides });
    expect(failures.join(' ')).toMatch(message);
  });

  it('allows a link when the subreddit allows links', () => {
    const withLink = output(`${MENTION} https://acme-invoices.example`, true);
    expect(checkDraft(withLink, { ...context, linksAllowed: true })).toEqual([]);
  });
});

describe('countWords', () => {
  it('counts words and ignores stray punctuation', () => {
    expect(countWords('Send it , then wait - ok?')).toBe(5);
  });
});

describe('writeDraft', () => {
  const request: DraftRequest = {
    kind: 'reply',
    profile,
    subreddit: 'freelance_demo',
    mode: 'soft_mention',
    linksAllowed: false,
    post: { id: 't3_d1', title: 'Clients pay late', body: 'How do I get paid on time?' },
    suggestedAngle: 'Reminder schedule',
    fixes: [],
    random: seededRandom(3),
  };

  const reply = (text: string, mentions = true) => ({
    output: { reply: text, mentions_product: mentions, includes_link: false, notes_for_user: '' },
  });

  it('returns a draft that passes the checks on the first try', async () => {
    const { ai, generator } = fakeAiClient(() => reply(MENTION));
    const result = await writeDraft(ai, request);
    expect(result).toMatchObject({ ok: true, failures: [], output: { reply: MENTION } });
    expect(generator.calls).toHaveLength(1);
    expect(generator.calls[0]?.subject.mode).toBe('soft_mention');
  });

  it('regenerates once with the failures as fixes', async () => {
    const { ai, generator } = fakeAiClient((call) =>
      call.prompt.includes('Fix these problems')
        ? reply(MENTION)
        : reply(`${HELPFUL} Try Acme Invoices.`),
    );
    const result = await writeDraft(ai, request);
    expect(result).toMatchObject({ ok: true, failures: [] });
    expect(generator.calls).toHaveLength(2);
    expect(generator.calls[1]?.prompt).toMatch(/Say plainly that you built Acme Invoices/);
  });

  it('keeps a draft that still fails after one regeneration, with its problems', async () => {
    const { ai, generator } = fakeAiClient(() => reply('Too short.'));
    const result = await writeDraft(ai, request);
    expect(generator.calls).toHaveLength(2);
    expect(result.ok && result.failures.join(' ')).toMatch(/words/);
  });

  it('starts from the reviewer fixes when given', async () => {
    const { ai, generator } = fakeAiClient(() => reply(MENTION));
    await writeDraft(ai, { ...request, fixes: ['Drop the claim about pricing'] });
    expect(generator.calls[0]?.prompt).toContain('- Drop the claim about pricing');
  });

  it('uses the shorter bounds for private messages', async () => {
    const dm = `${HELPFUL.split('. ').slice(0, 2).join('. ')}. I'm the maker of Acme Invoices.`;
    const { ai, generator } = fakeAiClient(() => reply(dm));
    const result = await writeDraft(ai, { ...request, kind: 'dm' });
    expect(result).toMatchObject({ ok: true, failures: [] });
    expect(generator.calls[0]?.system).toContain('25 to 90 words');
  });

  it('asks for the chosen reply length in sentences and words', async () => {
    const { ai, generator } = fakeAiClient(() => reply(MENTION));
    await writeDraft(ai, { ...request, length: 'short' });
    expect(generator.calls[0]?.system).toContain(
      'Length: Two to four sentences, in one paragraph. 25 to 70 words.',
    );
  });

  it('reports a failed call', async () => {
    const { ai } = fakeAiClient(() => ({ fail: 'provider_error', message: 'down' }));
    expect(await writeDraft(ai, request)).toEqual({
      ok: false,
      kind: 'provider_error',
      message: 'down',
    });
  });
});
