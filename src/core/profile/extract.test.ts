import { describe, expect, it } from 'vitest';
import { createAiClient } from '../ai/client';
import { createFakeGenerator, type FakeReply } from '../ai/fake';
import type { ExtractedProfile } from '../ai/schemas';
import { silentLogger } from '../log';
import { buildShortProfile, extractProfile, mergeInterview } from './extract';

const extracted: ExtractedProfile = {
  name: 'Acme Logs',
  product_type: 'developer_tool',
  audience: 'developers',
  one_liner: 'Search and tail logs from several servers in one terminal.',
  what_it_does: ['Tails logs over SSH', 'Searches across servers'],
  who_it_is_for: ['Developers with a handful of servers'],
  problems_solved: ['Too many SSH sessions to read logs', 'Searching one error on many machines'],
  not_for: ['Metrics', 'Tracing', 'Hosted log storage'],
  pricing: 'Open source',
  alternatives: ['multiple SSH sessions'],
  buyer_phrases: ['tail logs on multiple servers'],
  open_questions: ['Does it support Windows servers?'],
};

function client(reply: FakeReply) {
  const generator = createFakeGenerator(() => reply);
  const ai = createAiClient({
    generator,
    resolveModel: () => ({
      ok: true,
      model: { provider: 'openai', model: 'strong' },
      credentials: { apiKey: '', baseUrl: null },
    }),
    usage: { check: () => ({ ok: true }), record: () => null },
    redact: (text) => text,
    log: silentLogger(),
  });
  return { ai, generator };
}

describe('extractProfile', () => {
  it('asks the model for a profile from the crawled pages', async () => {
    const { ai, generator } = client({ output: extracted });
    const result = await extractProfile(ai, {
      url: 'https://acme-logs.example',
      pages: [{ url: 'https://acme-logs.example/', text: 'Tail logs from many servers.' }],
      description: null,
    });
    expect(result).toEqual({ ok: true, profile: extracted });
    expect(generator.calls[0]?.task).toBe('profile');
    expect(generator.calls[0]?.prompt).toContain('Tail logs from many servers.');
  });

  it('returns the failure message when the model call fails', async () => {
    const { ai } = client({ fail: 'provider_error', message: 'overloaded' });
    const result = await extractProfile(ai, {
      url: 'https://acme-logs.example',
      pages: [],
      description: 'A log tool',
    });
    expect(result).toEqual({ ok: false, message: 'overloaded' });
  });
});

describe('mergeInterview', () => {
  it('adds the interview answers and builds the short profile', () => {
    const profile = mergeInterview(extracted, 'https://acme-logs.example', {
      bestCustomer: 'A developer with five servers',
      misconceptions: 'It does not store logs',
      neverReplyTo: 'Kubernetes tracing questions',
      includeLinks: false,
      redditUsername: 'u/demo_user_42',
      openAnswers: [{ question: 'Does it support Windows servers?', answer: 'Not yet.' }],
    });
    expect(profile).toMatchObject({
      url: 'https://acme-logs.example',
      best_customer: 'A developer with five servers',
      misconceptions: 'It does not store logs',
      never_reply_to: 'Kubernetes tracing questions',
      include_links: false,
      reddit_username: 'demo_user_42',
      founder_notes: ['Does it support Windows servers? Not yet.'],
    });
    expect(profile.short).toBe(buildShortProfile(profile));
  });

  it('treats every interview answer as optional', () => {
    const profile = mergeInterview(extracted, 'https://acme-logs.example', {});
    expect(profile).toMatchObject({
      include_links: true,
      reddit_username: null,
      founder_notes: [],
    });
  });

  it('ignores open questions the founder left blank', () => {
    const profile = mergeInterview(extracted, 'https://acme-logs.example', {
      openAnswers: [{ question: 'Anything else?', answer: '   ' }],
    });
    expect(profile.founder_notes).toEqual([]);
  });
});

describe('buildShortProfile', () => {
  it('summarises what the product does, for whom, and what it is not for', () => {
    const short = buildShortProfile(mergeInterview(extracted, 'https://acme-logs.example', {}));
    expect(short).toContain('Acme Logs');
    expect(short).toContain('Search and tail logs');
    expect(short).toContain('Developers with a handful of servers');
    expect(short).toContain('Not for: Metrics; Tracing; Hosted log storage');
  });

  it('stays under 200 words for a long profile', () => {
    const long = mergeInterview(
      {
        ...extracted,
        what_it_does: Array.from({ length: 6 }, () => 'word '.repeat(40)),
        problems_solved: Array.from({ length: 8 }, () => 'word '.repeat(40)),
      },
      'https://acme-logs.example',
      {},
    );
    expect(buildShortProfile(long).split(/\s+/).length).toBeLessThanOrEqual(200);
  });
});
