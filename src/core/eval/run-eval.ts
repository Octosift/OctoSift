/**
 * Runs triage and qualify over the golden set with the configured models
 * and scores the result. Uses the same stage code, veto rules and score as
 * a real scan, so the numbers describe what a scan would do.
 */
import type { AiClient } from '../ai/client';
import type { Clock } from '../clock';
import { CONFIG } from '../config';
import {
  goldenToRedditPost,
  loadGoldenSet,
  type GoldenOutcome,
  type GoldenPost,
} from '../eval/golden';
import { loadSampleProduct, type SampleProductSlug } from '../demo/sample-products';
import { qualifyPost } from '../pipeline/qualify';
import { finalScore } from '../pipeline/score';
import { triagePosts } from '../pipeline/triage';
import { applyVeto } from '../pipeline/veto';
import { confusionByFit, leadRates, triageRates, worstMisses, type EvalCase } from './metrics';

/** Outcomes decided before any AI call; those posts are not part of the evaluation. */
const NOT_EVALUATED: readonly GoldenOutcome[] = [
  'prefilter_skip',
  'crosspost',
  'too_old',
  'brand_mention',
];

export function evaluablePosts(slug: SampleProductSlug): GoldenPost[] {
  return loadGoldenSet(slug).posts.filter((post) => !NOT_EVALUATED.includes(post.label.expect));
}

export interface EvalOptions {
  ai: AiClient;
  products: SampleProductSlug[];
  clock: Clock;
  showThreshold: number;
  /** Current spend of this evaluation, to report and to stop on. */
  spend: () => { costUsd: number; incomplete: boolean };
}

export interface EvalReport {
  cases: EvalCase[];
  triage: ReturnType<typeof triageRates>;
  leads: ReturnType<typeof leadRates>;
  confusion: ReturnType<typeof confusionByFit>;
  worst: EvalCase[];
  costUsd: number;
  costIncomplete: boolean;
  costPerPost: number | null;
  errors: number;
  stoppedForBudget: boolean;
}

export async function runEvaluation(options: EvalOptions): Promise<EvalReport> {
  const now = Math.floor(options.clock.nowMs() / 1000);
  const cases: EvalCase[] = [];
  let errors = 0;
  let stoppedForBudget = false;

  for (const slug of options.products) {
    const profile = loadSampleProduct(slug);
    const posts = evaluablePosts(slug);
    const triage = await triagePosts(
      options.ai,
      profile,
      posts.map((post) => ({
        id: post.id,
        subreddit: post.subreddit,
        title: post.title,
        bodyText: post.body,
      })),
    );
    stoppedForBudget ||= triage.stoppedForBudget;
    for (const post of posts) {
      const outcome = triage.outcomes.get(post.id);
      const base = {
        product: slug,
        id: post.id,
        title: post.title,
        label: post.label,
        expectedLead: post.label.expect === 'lead',
      };
      if (!outcome || outcome.verdict === 'error') {
        errors += outcome?.verdict === 'error' && !outcome.budget ? 1 : 0;
        cases.push({
          ...base,
          triageRelevant: null,
          fit: null,
          score: null,
          reason: outcome?.reason ?? 'Not judged',
          predictedLead: false,
        });
        continue;
      }
      if (outcome.verdict === 'skip' || stoppedForBudget) {
        cases.push({
          ...base,
          triageRelevant: outcome.verdict === 'pass',
          fit: null,
          score: null,
          reason: outcome.reason,
          predictedLead: false,
        });
        continue;
      }
      const reddit = goldenToRedditPost(post, now);
      const qualified = await qualifyPost(
        options.ai,
        {
          id: post.id,
          subreddit: post.subreddit,
          title: post.title,
          bodyText: post.body,
          createdAt: reddit.createdAt,
        },
        { profile, rulesSummary: null, feedback: { rules: [], good: [], bad: [] }, now },
      );
      if (!qualified.ok) {
        if (qualified.kind === 'budget') stoppedForBudget = true;
        else errors += 1;
        cases.push({
          ...base,
          triageRelevant: true,
          fit: null,
          score: null,
          reason: qualified.message,
          predictedLead: false,
        });
        continue;
      }
      const veto = applyVeto({
        qualify: qualified.result,
        internalFlags: qualified.internalFlags,
        postText: `${post.title}\n${post.body}`,
        subredditNoPromotion: false,
        rulesPromotion: null,
        vetoPhrases: [],
      });
      const score = finalScore({
        modelScore: qualified.result.score,
        ageHours: post.ageHours,
        flags: veto.flags,
      });
      cases.push({
        ...base,
        triageRelevant: true,
        fit: qualified.result.fit,
        score,
        reason: qualified.result.reason,
        predictedLead: veto.lead && score >= options.showThreshold,
      });
    }
    if (stoppedForBudget) break;
  }

  const spend = options.spend();
  const judged = cases.filter((item) => item.triageRelevant !== null).length;
  return {
    cases,
    triage: triageRates(cases),
    leads: leadRates(cases),
    confusion: confusionByFit(cases),
    worst: worstMisses(cases),
    costUsd: spend.costUsd,
    costIncomplete: spend.incomplete,
    costPerPost: judged === 0 ? null : spend.costUsd / judged,
    errors,
    stoppedForBudget,
  };
}

export const DEFAULT_SHOW_THRESHOLD = CONFIG.thresholds.show;
