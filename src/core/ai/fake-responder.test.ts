import { describe, expect, it } from 'vitest';
import { loadGoldenSet } from '../eval/golden';
import { checkDraft } from '../pipeline/draft';
import { loadSampleProducts } from '../testing/sample-products';
import { createFixtureResponder } from './fake-responder';
import { draftWire, normalizeDraft, profileWire, qualifyWire, triageWire } from './schemas';
import type { GenerateRequest } from './types';

const golden = loadGoldenSet('acme-invoices');
const profiles = loadSampleProducts();
const respond = createFixtureResponder({
  labels: new Map(golden.posts.map((post) => [post.id, post.label])),
  profiles: Object.values(profiles),
  suggestions: { 'Acme Invoices': ['freelance_demo'] },
});

function request(overrides: Partial<GenerateRequest>): GenerateRequest {
  return {
    task: 'triage',
    model: { provider: 'openai_compatible', model: 'fake' },
    credentials: { apiKey: '', baseUrl: null },
    system: '',
    prompt: '',
    schema: null,
    maxOutputTokens: 100,
    timeoutMs: 1_000,
    subject: {},
    ...overrides,
  };
}

function outputOf(reply: ReturnType<typeof respond>): unknown {
  if ('fail' in reply) throw new Error('unexpected failure');
  return reply.output;
}

describe('fixture responder', () => {
  it('answers triage from the labels and treats unknown posts as not relevant', () => {
    const output = triageWire.parse(
      outputOf(respond(request({ subject: { postIds: ['t3_inv01', 't3_inv22', 't3_unknown'] } }))),
    );
    expect(output.results.map((result) => result.relevant)).toEqual([true, false, false]);
  });

  it('answers qualify with the label and the middle of its score band', () => {
    const output = qualifyWire.parse(
      outputOf(respond(request({ task: 'qualify', subject: { postIds: ['t3_inv07'] } }))),
    );
    expect(output).toMatchObject({ fit: 'direct', score: 82, mention_ok: true });
  });

  it.each(['helpful_only', 'soft_mention', 'direct'])(
    'writes a %s draft that passes the checks',
    (mode) => {
      const reply = normalizeDraft(
        draftWire.parse(
          outputOf(
            respond(
              request({
                task: 'draft',
                subject: {
                  productName: 'Acme Invoices',
                  productUrl: 'https://acme-invoices.example',
                  mode,
                },
              }),
            ),
          ),
        ),
      );
      expect(
        checkDraft(reply, {
          mode: mode as 'helpful_only',
          linksAllowed: false,
          productName: 'Acme Invoices',
          productHost: 'acme-invoices.example',
          words: { min: 40, max: 180 },
        }),
      ).toEqual([]);
    },
  );

  it('returns the sample profile for a known product URL', () => {
    const output = profileWire.parse(
      outputOf(
        respond(
          request({ task: 'profile', subject: { productUrl: 'https://acme-plants.example' } }),
        ),
      ),
    );
    expect(output.name).toBe('Acme Plants');
  });

  it('fails profile extraction for an unknown URL', () => {
    expect(
      respond(request({ task: 'profile', subject: { productUrl: 'https://unknown.example' } })),
    ).toMatchObject({
      fail: 'invalid_output',
    });
  });
});
