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
import type { AiTask, AiUsage, ModelRef } from './types';

export type PriceTable = SettingValue<'ai.prices'>;
export type ModelPrice = PriceTable[string];

export interface BudgetCaps {
  perRunUsd: number;
  perDayUsd: number;
}

export interface UsageSummary {
  /** AI and data together. */
  costUsd: number;
  /** The part spent on a paid Reddit data provider. */
  dataCostUsd: number;
  /** True when at least one call had no known price. */
  incomplete: boolean;
  calls: number;
}

export interface UsageLedger extends UsageRecorder {
  /** Records one paid request to a Reddit data provider; it counts against the same caps. */
  recordData(costUsd: number, what: string): void;
  summary(): UsageSummary;
}

/** The usage stage of paid Reddit data requests. */
export const DATA_STAGE = 'reddit_data';

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

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function createUsageLedger(options: UsageLedgerOptions): UsageLedger {
  const { db, clock, runId, prices, caps, persist = true } = options;
  const totals: UsageSummary = { costUsd: 0, dataCostUsd: 0, incomplete: false, calls: 0 };

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
      const price = priceFor(prices(), model);
      const cost = price ? costOf(price, used) : null;
      if (persist) {
        insertUsage(db, {
          id: newId(),
          runId,
          stage: task,
          provider: model.provider,
          model: model.model,
          inputTokens: used.inputTokens,
          outputTokens: used.outputTokens,
          costUsd: cost,
          createdAt: nowSeconds(clock),
        });
      }
      totals.calls += 1;
      if (cost === null) totals.incomplete = true;
      else totals.costUsd += cost;
      return cost;
    },

    recordData(costUsd, what) {
      if (persist) {
        insertUsage(db, {
          id: newId(),
          runId,
          stage: DATA_STAGE,
          provider: what.split('/')[0] ?? what,
          model: what,
          inputTokens: 0,
          outputTokens: 0,
          costUsd,
          createdAt: nowSeconds(clock),
        });
      }
      totals.costUsd += costUsd;
      totals.dataCostUsd += costUsd;
    },

    summary: () => ({ ...totals }),
  };
}
