/**
 * Answers for the fake generator, derived from fixture labels.
 *
 * Triage and qualify answer as the label says a good model would. Drafts
 * come from product-neutral templates that pass the deterministic checks.
 * Used by integration tests and demo mode; real models never see this.
 */
import type { GoldenLabel } from '../eval/golden';
import { labelScore } from '../eval/golden';
import type { ProductProfile } from '../profile/types';
import type { FakeReply } from './fake';
import type { ExtractedProfile } from './schemas';
import type { GenerateRequest } from './types';

export interface FixtureResponderOptions {
  labels: ReadonlyMap<string, GoldenLabel>;
  profiles: readonly ProductProfile[];
  /** Subreddit suggestions by product name. */
  suggestions?: Readonly<Record<string, readonly string[]>>;
}

const HELPFUL =
  'Start with the part you can change this week. Write down what you have already tried and what ' +
  'happened each time, then change one thing at a time so you can see what actually helps. People ' +
  'here usually suggest keeping it simple before spending money, and that advice holds for your ' +
  'situation too.';

function reason(label: GoldenLabel): string {
  if (label.fit === 'direct') return 'The author is looking for what the product does.';
  if (label.fit === 'soft') return 'Related to a problem the product solves.';
  return 'The product would not help with what the author wants.';
}

function draftText(request: GenerateRequest): { text: string; mentions: boolean; link: boolean } {
  const name = request.subject.productName ?? 'the product';
  const isDm = request.system.includes('private message');
  const mode = request.subject.mode ?? 'helpful_only';
  const link = request.subject.linksAllowed === true && mode !== 'helpful_only';
  const url = link && request.subject.productUrl ? ` ${request.subject.productUrl}` : '';
  if (isDm) {
    return {
      text:
        `Hi, I saw your post and wanted to reply privately since you invited messages. I'm the maker of ` +
        `${name}, which was built for this kind of problem.${url} Happy to answer questions, and no ` +
        'pressure at all if it is not a fit for you.',
      mentions: true,
      link,
    };
  }
  if (mode === 'helpful_only') return { text: HELPFUL, mentions: false, link: false };
  if (mode === 'direct') {
    return {
      text: `I'm the maker of ${name}, so I'm biased, but it was built for exactly this.${url} ${HELPFUL}`,
      mentions: true,
      link,
    };
  }
  return {
    text: `${HELPFUL} Full disclosure: I'm the maker of ${name}, which was built for this kind of problem.${url}`,
    mentions: true,
    link,
  };
}

function extracted(profile: ProductProfile): ExtractedProfile {
  return {
    name: profile.name,
    product_type: profile.product_type,
    audience: profile.audience,
    one_liner: profile.one_liner,
    what_it_does: profile.what_it_does,
    who_it_is_for: profile.who_it_is_for,
    problems_solved: profile.problems_solved,
    not_for: profile.not_for,
    pricing: profile.pricing,
    alternatives: profile.alternatives,
    buyer_phrases: profile.buyer_phrases,
    open_questions: ['Do you offer a free trial?'],
  };
}

export function createFixtureResponder(options: FixtureResponderOptions) {
  const { labels, profiles, suggestions = {} } = options;

  return (request: GenerateRequest): FakeReply => {
    const ids = request.subject.postIds ?? [];
    switch (request.task) {
      case 'triage':
        return {
          output: {
            results: ids.map((id) => {
              const label = labels.get(id);
              const relevant = label?.relevant ?? false;
              return {
                id,
                relevant,
                why: relevant
                  ? 'Mentions a problem the product covers'
                  : 'Not about a problem the product solves',
              };
            }),
          },
        };
      case 'qualify': {
        const label = labels.get(ids[0] ?? '');
        if (!label) {
          return {
            output: {
              fit: 'none',
              intent: 'other',
              score: 10,
              reason: 'Unknown post',
              evidence_quote: '',
              mention_ok: false,
              dm_ok: false,
              suggested_angle: '',
              risk_flags: [],
              alternatives_mentioned: [],
            },
          };
        }
        return {
          output: {
            fit: label.fit,
            intent: label.intent,
            score: labelScore(label),
            reason: reason(label),
            evidence_quote: label.evidence,
            mention_ok: label.mentionOk,
            dm_ok: label.dmOk,
            suggested_angle: 'Answer the question first, then share what worked for others.',
            risk_flags: label.riskFlags,
            alternatives_mentioned: [],
          },
        };
      }
      case 'draft': {
        const draft = draftText(request);
        return {
          output: {
            reply: draft.text,
            mentions_product: draft.mentions,
            includes_link: draft.link,
            notes_for_user: 'Check the details match your own experience before posting.',
          },
        };
      }
      case 'review': {
        const decision = labels.get(ids[0] ?? '')?.review ?? 'APPROVE';
        return {
          output: {
            decision,
            reasons:
              decision === 'APPROVE'
                ? ['Helpful, specific and discloses the affiliation.']
                : ['Reads like an advertisement.'],
            fixes:
              decision === 'APPROVE'
                ? []
                : ['Lead with the advice and keep the product to one sentence.'],
          },
        };
      }
      case 'profile': {
        const profile = profiles.find((candidate) => candidate.url === request.subject.productUrl);
        return profile
          ? { output: extracted(profile) }
          : { fail: 'invalid_output', message: 'Unknown product' };
      }
      case 'subreddits':
        return {
          output: {
            suggestions: (suggestions[request.subject.productName ?? ''] ?? []).map((name) => ({
              name,
              reason: 'People in your target audience ask questions here.',
              promotion_strictness: 'moderate',
            })),
          },
        };
      case 'rules':
        return {
          output: {
            promotion: 'restricted',
            links: 'forbidden',
            notes: ['Be helpful first', 'Disclose any affiliation'],
          },
        };
      case 'image':
        return { output: 'A photo related to the post.' };
      case 'test':
        return { output: 'OK' };
    }
  };
}
