/**
 * The AI cost ledger and budget caps.
 *
 * Every call is written to the usage table with its tokens and, when the
 * model has a price, its cost. Before each call the ledger checks two caps:
 * the cost of the current run and the cost of the last 24 hours across all
 * runs. Calls with an unknown price do not count towards the caps; the run
 * total is marked incomplete instead.
 */
import { nowSeconds, type Clock } from '../clock';
import type { Db } from '../db/client';
import { costSince, insertUsage } from '../db/queries/usage';
import { newId } from '../ids';
import type { SettingValue } from '../settings/registry';
import type { UsageRecorder } from './client';
import { catalogModel } from './presets';
import type { AiTask, AiUsage, ModelRef } from './types';

export type PriceTable = SettingValue<'ai.prices'>;
export type ModelPrice = PriceTable[string];

export interface BudgetCaps {
  perRunUsd: number;
  perDayUsd: number;
}

export interface UsageSummary {
  costUsd: number;
  /** What the subscription calls would have cost on the API; null when there were none. */
  apiEquivalentUsd: number | null;
  /** True when at least one call had no known price. */
  incomplete: boolean;
  calls: number;
}

export interface UsageLedger extends UsageRecorder {
  summary(): UsageSummary;
}

export interface UsageLedgerOptions {
  db: Db;
  clock: Clock;
  runId: string | null;
  prices: () => PriceTable;
  caps: () => BudgetCaps;
  /** False for dry runs: totals are kept but nothing is written. */
  persist?: boolean;
}

const DAY_S = 24 * 3600;

/** Looks up "provider/model" first, then the bare model id. */
export function priceFor(prices: PriceTable, model: ModelRef): ModelPrice | null {
  return prices[`${model.provider}/${model.model}`] ?? prices[model.model] ?? null;
}

export function costOf(price: ModelPrice, used: AiUsage): number {
  return (
    (used.inputTokens * price.inputPerMillionUsd + used.outputTokens * price.outputPerMillionUsd) /
    1_000_000
  );
}

/** Providers whose calls are billed to the user's subscription, not per token. */
export function billedToSubscription(model: ModelRef): boolean {
  return model.provider === 'codex_cli';
}

/**
 * The API price of a subscription call: cached input at the cached rate when
 * the price has one. The CLI's models are the OpenAI API models of the same
 * id, so their API price is looked up there too, then in the catalogue.
 */
export function apiEquivalentOf(prices: PriceTable, model: ModelRef, used: AiUsage): number | null {
  const price =
    priceFor(prices, model) ??
    priceFor(prices, { provider: 'openai', model: model.model }) ??
    catalogModel(model.provider, model.model)?.price ??
    null;
  if (!price) return null;
  const cached = Math.min(used.cachedInputTokens ?? 0, used.inputTokens);
  const cachedRate = price.cachedInputPerMillionUsd ?? price.inputPerMillionUsd;
  return (
    ((used.inputTokens - cached) * price.inputPerMillionUsd +
      cached * cachedRate +
      used.outputTokens * price.outputPerMillionUsd) /
    1_000_000
  );
}

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function createUsageLedger(options: UsageLedgerOptions): UsageLedger {
  const { db, clock, runId, prices, caps, persist = true } = options;
  const totals: UsageSummary = { costUsd: 0, apiEquivalentUsd: null, incomplete: false, calls: 0 };

  return {
    check() {
      const { perRunUsd, perDayUsd } = caps();
      if (totals.costUsd >= perRunUsd) {
        return {
          ok: false,
          message: `This scan reached its budget of ${usd(perRunUsd)}. Remaining posts will be processed on the next scan.`,
        };
      }
      const lastDay = costSince(db, nowSeconds(clock) - DAY_S);
      if (lastDay >= perDayUsd) {
        return {
          ok: false,
          message: `The daily budget of ${usd(perDayUsd)} is used up. Scans continue once spending from the last 24 hours drops below it.`,
        };
      }
      return { ok: true };
    },

    record(task: AiTask, model: ModelRef, used: AiUsage) {
      const subscription = billedToSubscription(model);
      const price = priceFor(prices(), model);
      // Subscription calls cost nothing per token; their API equivalent is kept apart.
      const cost = subscription ? 0 : price ? costOf(price, used) : null;
      const apiEquivalent = subscription ? apiEquivalentOf(prices(), model, used) : null;
      if (persist) {
        insertUsage(db, {
          id: newId(),
          runId,
          stage: task,
          provider: model.provider,
          model: model.model,
          inputTokens: used.inputTokens,
          outputTokens: used.outputTokens,
          cachedInputTokens: used.cachedInputTokens ?? 0,
          costUsd: cost,
          apiEquivalentUsd: apiEquivalent,
          createdAt: nowSeconds(clock),
        });
      }
      totals.calls += 1;
      if (cost === null) totals.incomplete = true;
      else totals.costUsd += cost;
      if (subscription)
        totals.apiEquivalentUsd = (totals.apiEquivalentUsd ?? 0) + (apiEquivalent ?? 0);
      return cost;
    },

    summary: () => ({ ...totals }),
  };
}
