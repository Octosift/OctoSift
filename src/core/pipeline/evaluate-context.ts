/** What the evaluation steps of a scan share, and how they record verdicts. */
import type { AiClient } from '../ai/client';
import type { FeedbackContext } from '../ai/prompts/qualify';
import type { Random } from '../clock';
import type { Db } from '../db/client';
import type { Product } from '../db/queries/products';
import type { EvaluationStage, EvaluationVerdict } from '../db/schema';
import type { Logger } from '../log';
import type { ProductProfile } from '../profile/types';
import type { SettingsStore } from '../settings/store';
import type { AiGuard } from './ai-guard';
import type { FunnelCounts } from './funnel';
import type { ScanStore } from './store';

export type ReadyProduct = Product & { profile: ProductProfile };

export interface LeadSummary {
  id: string;
  productName: string;
  score: number;
  title: string;
  subreddit: string;
  url: string;
  reason: string;
  drafted: boolean;
}

export interface LeadNotice {
  leadId: string;
  productName: string;
  title: string;
  subreddit: string;
  score: number;
  reason: string;
  url: string;
}

export interface EvaluateContext {
  db: Db;
  store: ScanStore;
  ai: AiClient;
  guard: AiGuard;
  settings: SettingsStore;
  counts: FunnelCounts;
  log: Logger;
  random: Random;
  runId: string;
  now: number;
  detectLanguage: (text: string) => string | null;
  feedbackFor: (productId: string) => FeedbackContext;
  /** Resolves to true when the notification was delivered. */
  notify: ((notice: LeadNotice) => Promise<boolean>) | null;
  newLeads: LeadSummary[];
  /** Called after each step so progress can be shown while the scan runs. */
  onProgress: () => void;
  /** Set once the budget is exhausted; shared across products. */
  state: { budgetStop: string | null };
}

/** AI work stops for the rest of the scan once the budget or the AI guard says so. */
export function aiAvailable(ctx: EvaluateContext): boolean {
  return ctx.state.budgetStop === null && ctx.guard.tripped() === null;
}

export function saveVerdict(
  ctx: EvaluateContext,
  productId: string,
  postId: string,
  stage: EvaluationStage,
  verdict: EvaluationVerdict,
  reason: string,
  extra: { data?: unknown; model?: string | null } = {},
): void {
  ctx.store.saveEvaluation({
    productId,
    postId,
    stage,
    verdict,
    reason,
    dataJson: extra.data ?? null,
    model: extra.model ?? null,
    runId: ctx.runId,
    createdAt: ctx.now,
  });
}
