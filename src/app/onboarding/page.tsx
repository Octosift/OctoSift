import type { Metadata } from 'next';
import { AI_STAGES } from '@/core/settings/registry';
import { listProducts, watchedSubreddits } from '@/core/db/queries/products';
import { recentRuns } from '@/core/db/queries/runs';
import { BRAND } from '@/core/brand';
import { loadSettings } from '../lib/data/settings';
import { getRuntime } from '../lib/runtime';
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
    product: product ? { id: product.id, name: product.name, url: product.url } : null,
    subreddits,
    hasRun: recentRuns(runtime.db, 1).length > 0,
    demo: runtime.env.DEMO_MODE,
  };
}

function firstIncomplete(state: OnboardingState): number {
  if (!state.aiReady) return 1;
  if (!state.product) return 2;
  if (state.subreddits.length < 3) return 3;
  return 4;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const state = loadState();
  const allowed = firstIncomplete(state);
  const requested = Number((await searchParams).step ?? allowed);
  const step =
    Number.isInteger(requested) && requested >= 1 && requested <= allowed ? requested : allowed;
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
        settings={step === 1 ? loadSettings() : null}
        blocked={requested > allowed}
      />
    </main>
  );
}
