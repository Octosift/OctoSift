import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scriptedReply } from '../ai/fake-responder';
import { CONFIG } from '../config';
import { loadGoldenSet } from '../eval/golden';
import { checkDraft, wordBounds } from '../pipeline/draft';
import { containsTerm } from '../pipeline/prefilter';
import { loadScriptedLeads } from './lead-content';
import { loadSampleProduct } from './sample-products';

const scripted = loadScriptedLeads();
const product = loadSampleProduct('acme-invoices');
const leadPosts = [
  ...loadGoldenSet('acme-invoices').posts,
  ...loadGoldenSet('acme-invoices-history', resolve(process.cwd(), 'fixtures/demo')).posts,
].filter((post) => post.label.expect === 'lead');

function check(text: string, mentions: boolean, mode: 'helpful_only' | 'soft_mention' | 'direct') {
  return checkDraft(
    { reply: text, mentionsProduct: mentions, includesLink: false, notesForUser: '' },
    {
      mode,
      linksAllowed: false,
      productName: product.name,
      productHost: 'acme-invoices.example',
      words: wordBounds('reply'),
    },
  );
}

describe('scripted demo leads', () => {
  it('cover every Acme Invoices lead and nothing else', () => {
    expect([...scripted.keys()].sort()).toEqual(leadPosts.map((post) => post.id).sort());
  });

  it('give varied scores that keep every post a lead', () => {
    const scores = [...scripted.values()].map((lead) => lead.score);
    expect(new Set(scores).size).toBeGreaterThanOrEqual(25);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(CONFIG.thresholds.show);
    expect(new Set([...scripted.values()].map((lead) => lead.reason)).size).toBe(scripted.size);
  });

  it.each(leadPosts.map((post) => [post.id, post] as const))(
    'writes replies for %s that pass the draft checks in every mode it can get',
    (id, post) => {
      const lead = scripted.get(id);
      expect(lead).toBeDefined();
      if (!lead) return;
      const modes = post.label.mentionOk
        ? (['helpful_only', 'soft_mention', 'direct'] as const)
        : (['helpful_only'] as const);
      if (!post.label.mentionOk) expect(lead.pitch).toBeUndefined();
      for (const mode of modes) {
        const reply = scriptedReply(lead, {
          kind: 'reply',
          mode,
          productName: product.name,
          link: null,
        });
        expect(check(reply.text, reply.mentions, mode), `${id} in ${mode}`).toEqual([]);
      }
      expect(containsTerm(lead.advice, product.name), `${id} advice names the product`).toBe(false);
      if (post.label.dmOk) {
        const dm = scriptedReply(lead, {
          kind: 'dm',
          mode: 'direct',
          productName: product.name,
          link: null,
        });
        const words = dm.text.split(/\s+/).length;
        expect(lead.dm, `${id} needs a private message`).toBeDefined();
        expect(words).toBeGreaterThanOrEqual(wordBounds('dm').min);
        expect(words).toBeLessThanOrEqual(wordBounds('dm').max);
      }
    },
  );
});
