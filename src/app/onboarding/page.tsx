import type { Metadata } from 'next';
import { AI_STAGES } from '@/core/settings/registry';
import { listProducts, watchedSubreddits } from '@/core/db/queries/products';
import { recentRuns } from '@/core/db/queries/runs';
import { BRAND } from '@/core/brand';
import { sessionStatus } from '@/core/reddit/account';
import { loadSettings } from '../lib/data/settings';
import { getRuntime, nowSeconds } from '../lib/runtime';
import { stepNumber } from './steps';
import { Wizard, type OnboardingState } from './wizard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Get started' };

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

/**
 * The furthest step that may be shown, and the one to open by default. Only
 * the AI step is required: the account and subreddit steps can be skipped,
 * and skipping the product step ends onboarding. A fresh setup still opens on
 * each optional step once.
 */
function progress(state: OnboardingState): { allowed: number; landing: number } {
  const at = (id: Parameters<typeof stepNumber>[0]) => stepNumber(id);
  if (!state.aiReady) return { allowed: at('ai'), landing: at('ai') };
  if (!state.product) {
    return {
      allowed: at('product'),
      landing: state.accountConnected ? at('product') : at('account'),
    };
  }
  return {
    allowed: at('scan'),
    landing: state.subreddits.length === 0 ? at('subreddits') : at('scan'),
  };
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const state = loadState();
  const { allowed, landing } = progress(state);
  const requested = Number((await searchParams).step ?? landing);
  const step =
    Number.isInteger(requested) && requested >= 1 && requested <= allowed ? requested : landing;
  const needsSettings = step === stepNumber('ai') || step === stepNumber('account');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{BRAND.name}</p>
        <h1 className="text-lg font-semibold tracking-tight">Set up your first product</h1>
        <p className="text-[13px] text-muted-foreground">
          About five minutes. Everything stays on this machine; you can change any of it later.
        </p>
      </header>
      <Wizard
        step={step}
        state={state}
        settings={needsSettings ? loadSettings() : null}
        now={nowSeconds()}
        blocked={requested > allowed}
      />
    </main>
  );
}
