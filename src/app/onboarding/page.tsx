import { ArrowLeft, MessagesSquare } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AI_STAGES } from '@/core/settings/registry';
import { listProducts, watchedSubreddits } from '@/core/db/queries/products';
import { recentRuns } from '@/core/db/queries/runs';
import { BRAND } from '@/core/brand';
import { sessionStatus } from '@/core/reddit/account';
import { loadSettings } from '../lib/data/settings';
import { getRuntime, nowSeconds } from '../lib/runtime';
import { STEPS, stepNumber, type StepId } from './steps';
import { Wizard, type OnboardingState } from './wizard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Set up' };

function loadState(): OnboardingState {
  const runtime = getRuntime();
  const products = listProducts(runtime.db);
  const product = products.at(-1) ?? null;
  const subreddits = product
    ? watchedSubreddits(runtime.db, product.id).map((entry) => entry.subreddit)
    : [];
  return {
    aiReady: AI_STAGES.every((stage) => runtime.resolveModel(stage).ok),
    accountConnected: sessionStatus(runtime.db, runtime.secrets).status === 'connected',
    product: product ? { id: product.id, name: product.name, url: product.url } : null,
    subreddits,
    hasRun: recentRuns(runtime.db, 1).length > 0,
    demo: runtime.env.DEMO_MODE,
  };
}

/** The step that has to be done before this one, if any. */
function blockerOf(step: StepId, state: OnboardingState): StepId | null {
  if (step === 'product' && !state.aiReady && !state.demo) return 'ai';
  if ((step === 'subreddits' || step === 'scan') && !state.product) {
    return state.aiReady || state.demo ? 'product' : 'ai';
  }
  return null;
}

/** Without a step in the address, the first one not done yet. */
function firstOpen(state: OnboardingState): StepId {
  if (!state.aiReady && !state.demo) return 'ai';
  if (!state.accountConnected && !state.demo) return 'account';
  if (!state.product) return 'product';
  if (state.subreddits.length === 0) return 'subreddits';
  return 'scan';
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const state = loadState();
  const number = Number((await searchParams).step);
  const requested: StepId = STEPS[number - 1]?.id ?? firstOpen(state);
  const blocker = blockerOf(requested, state);
  const step = blocker ?? requested;
  const needsSettings = step === 'ai' || step === 'account';
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <MessagesSquare className="size-4" aria-hidden />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">{BRAND.name}</span>
        </Link>
        <Link
          href="/"
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Finish later
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
        <Wizard
          step={stepNumber(step)}
          state={state}
          settings={needsSettings ? loadSettings() : null}
          now={nowSeconds()}
          blockedBy={blocker === null ? null : { wanted: requested, needed: blocker }}
        />
      </main>
    </div>
  );
}
