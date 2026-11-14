/**
 * One scan: fetch due subreddits, evaluate new and retryable posts for each
 * product, and record the run with its funnel counts and cost.
 *
 * Contract: a scan never throws. Reddit failures, AI failures and budget
 * stops end up in the run's status and error message. The caller is
 * responsible for making sure only one scan runs at a time.
 */
import { createAiClient, type ModelResolution } from '../ai/client';
import type { FeedbackContext } from '../ai/prompts/qualify';
import type { AiStage, Generator } from '../ai/types';
import { createUsageLedger } from '../ai/usage';
import { nowSeconds, type Clock, type Random } from '../clock';
import { CONFIG } from '../config';
import type { Db } from '../db/client';
import { recentPosts } from '../db/queries/posts';
import { getProduct, listProducts, watchedSubreddits, type Product } from '../db/queries/products';
import { createRun, finishRun, updateRunCounts } from '../db/queries/runs';
import type { RunStatus, RunTrigger } from '../db/schema';
import { newId } from '../ids';
import type { Logger } from '../log';
import type { ProductProfile } from '../profile/types';
import type { RedditSource } from '../reddit/types';
import type { SettingsStore } from '../settings/store';
import { guardAi } from './ai-guard';
import { collectPosts } from './collect';
import { evaluateProduct, type LeadNotice, type LeadSummary } from './evaluate';
import { emptyCounts, type FunnelCounts } from './funnel';
import { detectLanguage as defaultDetectLanguage } from './prefilter';
import { createDbStore, createDryRunStore } from './store';

export interface ScanDeps {
  db: Db;
  source: RedditSource;
  generator: Generator;
  resolveModel: (stage: AiStage) => ModelResolution;
  settings: SettingsStore;
  clock: Clock;
  random: Random;
  log: Logger;
  redact: (text: string) => string;
  feedbackFor?: (productId: string) => FeedbackContext;
  notify?: (notice: LeadNotice) => Promise<boolean>;
  detectLanguage?: (text: string) => string | null;
}

export interface ScanOptions {
  trigger: RunTrigger;
  /** Fetch and classify, but write nothing except the run row. */
  dryRun?: boolean;
  /** Limit the scan to one product and its subreddits. */
  productId?: string;
  /** Read every watched subreddit now, not only the ones that are due. */
  ignoreSchedule?: boolean;
  /**
   * Stops Reddit reads and AI work early; the run ends as partial with the
   * abort reason as its error. Used when the scan lock is lost.
   */
  signal?: AbortSignal;
}

export interface ScanReport {
  runId: string;
  status: RunStatus;
  counts: FunnelCounts;
  costUsd: number;
  costIncomplete: boolean;
  error: string | null;
  leads: LeadSummary[];
}

const NO_FEEDBACK: FeedbackContext = { rules: [], good: [], bad: [] };

function abortReason(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason.message : 'The scan was stopped.';
}

type ReadyProduct = Product & { profile: ProductProfile };

function productsFor(deps: ScanDeps, productId: string | undefined): ReadyProduct[] {
  const candidates =
    productId === undefined ? listProducts(deps.db) : [getProduct(deps.db, productId)];
  return candidates.filter((product): product is ReadyProduct => {
    if (product === null) return false;
    if (product.profile === null) {
      deps.log.warn('Skipping product with an unreadable profile', { productId: product.id });
      return false;
    }
    return true;
  });
}

function statusOf(
  counts: FunnelCounts,
  stops: { guard: string | null; budget: string | null; aborted: string | null },
): RunStatus {
  if (stops.guard !== null) return 'failed';
  if (stops.budget !== null) return 'budget_stopped';
  if (stops.aborted !== null) return 'partial';
  const errors =
    counts.triage.error + counts.qualify.error + counts.redditErrors + counts.drafts.failed;
  return counts.blocked || errors > 0 ? 'partial' : 'ok';
}

export async function runScan(deps: ScanDeps, options: ScanOptions): Promise<ScanReport> {
  const { db, settings, clock, log } = deps;
  const dryRun = options.dryRun ?? false;
  const runId = newId();
  const now = nowSeconds(clock);
  const counts = emptyCounts();
  const newLeads: LeadSummary[] = [];
  createRun(db, { id: runId, trigger: options.trigger, dryRun, now, counts });

  const store = dryRun ? createDryRunStore(db) : createDbStore(db);
  const ledger = createUsageLedger({
    db,
    clock,
    runId,
    prices: () => settings.get('ai.prices'),
    caps: () => ({
      perRunUsd: settings.get('budget.perRunUsd'),
      perDayUsd: settings.get('budget.perDayUsd'),
    }),
    persist: !dryRun,
  });
  const guard = guardAi(
    createAiClient({
      generator: deps.generator,
      resolveModel: deps.resolveModel,
      usage: ledger,
      redact: deps.redact,
      log,
    }),
    { maxFailureRatio: CONFIG.ai.maxFailureRatio, minCalls: CONFIG.ai.minCallsBeforeFailureCheck },
  );
  const state = { budgetStop: null as string | null, imagesFailed: false };
  let unexpected: string | null = null;

  try {
    const products = productsFor(deps, options.productId);
    const watched = new Map(
      products.map((product) => [
        product.id,
        watchedSubreddits(db, product.id)
          .filter((entry) => entry.enabled)
          .map((entry) => entry.subreddit),
      ]),
    );
    const allNames = [...new Set([...watched.values()].flat())];
    const collected = await collectPosts(
      {
        db,
        source: deps.source,
        store,
        counts,
        log,
        now,
        defaultIntervalMinutes: settings.get('schedule.intervalMinutes'),
        ...(options.signal ? { signal: options.signal } : {}),
      },
      allNames,
      { ignoreSchedule: options.ignoreSchedule ?? false },
    );
    const progress = () => {
      updateRunCounts(db, runId, counts);
    };
    progress();
    const since = now - settings.get('prefilter.maxPostAgeHours') * 3600;
    for (const product of products) {
      if (options.signal?.aborted) break;
      const names = watched.get(product.id) ?? [];
      const retryable = recentPosts(db, names, since).map((post) => post.id);
      await evaluateProduct(
        {
          db,
          store,
          ai: guard.ai,
          guard,
          settings,
          counts,
          log: log.child({ productId: product.id }),
          random: deps.random,
          runId,
          now,
          detectLanguage: deps.detectLanguage ?? defaultDetectLanguage,
          feedbackFor: deps.feedbackFor ?? (() => NO_FEEDBACK),
          // A dry run must not reach the founder's webhook with leads that are never saved.
          notify: dryRun ? null : (deps.notify ?? null),
          newLeads,
          onProgress: progress,
          state,
          ...(options.signal ? { signal: options.signal } : {}),
        },
        product,
        [...new Set([...collected.newPostIds, ...retryable])],
      );
    }
  } catch (error) {
    // Programmer errors must not take the worker down; record them on the run.
    unexpected = deps.redact(error instanceof Error ? error.message : String(error));
    log.error('Scan failed unexpectedly', { runId, error });
  }

  const usage = ledger.summary();
  const aborted = options.signal?.aborted ? abortReason(options.signal) : null;
  const status = unexpected
    ? 'failed'
    : statusOf(counts, { guard: guard.tripped(), budget: state.budgetStop, aborted });
  const error = unexpected ?? guard.tripped() ?? state.budgetStop ?? aborted;
  finishRun(db, runId, {
    now: nowSeconds(clock),
    status,
    counts,
    costUsd: usage.costUsd,
    dataCostUsd: usage.dataCostUsd,
    costIncomplete: usage.incomplete,
    error,
  });
  log.info('Scan finished', { runId, status, leads: counts.leads, costUsd: usage.costUsd });
  return {
    runId,
    status,
    counts,
    costUsd: usage.costUsd,
    costIncomplete: usage.incomplete,
    error,
    leads: newLeads,
  };
}
