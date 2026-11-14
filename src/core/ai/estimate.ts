/**
 * A rough monthly AI cost for a set of stage models, shown next to the
 * presets. It is an estimate: the token counts per post come from the
 * illustrative scan in the README (40 new posts: triage reads all of them in
 * batches, about a fifth reach qualify, and a few become drafts), and the
 * volume comes from the chosen subreddits when their post rates are known.
 */
import { CONFIG } from '../config';
import { catalogModel } from './presets';
import { priceFor, type PriceTable } from './usage';
import type { AiStage, ModelPrice, ModelRef } from './types';

/** Five typical subreddits at about 20 new posts an hour, before any are chosen. */
export const DEFAULT_POSTS_PER_DAY = 480;

const DAYS_PER_MONTH = 30;

/** Tokens per call share of one new post, by stage. */
export const STAGE_VOLUME: Record<
  AiStage,
  { share: number; inputTokens: number; outputTokens: number }
> = {
  triage: { share: 1, inputTokens: 350, outputTokens: 40 },
  qualify: { share: 0.2, inputTokens: 1_800, outputTokens: 250 },
  draft: { share: 0.075, inputTokens: 1_700, outputTokens: 300 },
  review: { share: 0.075, inputTokens: 1_600, outputTokens: 120 },
};

export interface MonthlyEstimate {
  /** Null when a stage has no known price. For the CLI provider, the API equivalent. */
  usd: number | null;
  /** True when the stages run on the CLI provider, which bills a subscription instead. */
  subscription: boolean;
  postsPerDay: number;
  /** Stages whose model has no price in the table or the catalogue. */
  unpriced: AiStage[];
}

function cliBatch(stage: AiStage): number {
  if (stage === 'triage') return CONFIG.ai.cliBatch.triage;
  return stage === 'qualify' ? CONFIG.ai.cliBatch.qualify : 1;
}

/** The price used for an estimate: the user's table first, then the catalogue. */
export function estimatePrice(prices: PriceTable, model: ModelRef): ModelPrice | null {
  return priceFor(prices, model) ?? catalogModel(model.provider, model.model)?.price ?? null;
}

export function estimateMonthlyCost(
  stages: Record<AiStage, ModelRef | null>,
  prices: PriceTable,
  postsPerDay: number,
): MonthlyEstimate {
  let perDay = 0;
  const unpriced: AiStage[] = [];
  for (const stage of Object.keys(STAGE_VOLUME) as AiStage[]) {
    const model = stages[stage];
    const price = model ? estimatePrice(prices, model) : null;
    if (!price) {
      unpriced.push(stage);
      continue;
    }
    const volume = STAGE_VOLUME[stage];
    const posts = postsPerDay * volume.share;
    // Every CLI call also carries the CLI's own instructions; batching keeps the calls few.
    const overhead =
      model?.provider === 'codex_cli'
        ? Math.ceil(posts / cliBatch(stage)) * CONFIG.ai.cliOverheadInputTokens
        : 0;
    perDay +=
      ((posts * volume.inputTokens + overhead) * price.inputPerMillionUsd +
        posts * volume.outputTokens * price.outputPerMillionUsd) /
      1_000_000;
  }
  return {
    usd: unpriced.length > 0 ? null : perDay * DAYS_PER_MONTH,
    subscription: Object.values(stages).every((model) => model?.provider === 'codex_cli'),
    postsPerDay,
    unpriced,
  };
}

/** Posts per day across subreddits, or the default when none has a measured rate. */
export function expectedPostsPerDay(rates: readonly (number | null)[]): {
  postsPerDay: number;
  measured: boolean;
} {
  const known = rates.filter((rate): rate is number => rate !== null && rate > 0);
  if (known.length === 0) return { postsPerDay: DEFAULT_POSTS_PER_DAY, measured: false };
  return { postsPerDay: known.reduce((sum, rate) => sum + rate, 0), measured: true };
}
