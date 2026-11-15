'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { Banner } from '../components/ui/display';
import { cn } from '../components/ui/utils';
import type { SettingsData } from '../lib/data/settings';
import { StepAccount } from './step-account';
import { StepAi } from './step-ai';
import { StepProduct } from './step-product';
import { StepScan } from './step-scan';
import { StepSubreddits } from './step-subreddits';
import { STEPS, stepNumber, type StepId } from './steps';

export interface OnboardingState {
  aiReady: boolean;
  accountConnected: boolean;
  product: { id: string; name: string; url: string } | null;
  subreddits: string[];
  hasRun: boolean;
  demo: boolean;
}

export function Wizard({
  step,
  state,
  settings,
  now,
  blockedBy,
}: {
  step: number;
  state: OnboardingState;
  settings: SettingsData | null;
  now: number;
  /** The step asked for could not be shown yet, and why. */
  blockedBy: { wanted: StepId; needed: StepId } | null;
}) {
  const show = (id: Parameters<typeof stepNumber>[0]) => step === stepNumber(id);
  const label = (id: StepId) => STEPS.find((entry) => entry.id === id)?.label ?? id;
  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Setup steps" className="flex flex-col gap-3">
        <p className="text-[13px] text-muted-foreground tabular">
          Step {step} of {STEPS.length}
        </p>
        <ol className="grid grid-cols-5 gap-1.5">
          {STEPS.map(({ id, label: name }, index) => {
            const number = index + 1;
            const current = number === step;
            const done =
              (id === 'ai' && (state.aiReady || state.demo)) ||
              (id === 'account' && (state.accountConnected || state.demo)) ||
              (id === 'product' && state.product !== null) ||
              (id === 'subreddits' && state.subreddits.length > 0) ||
              (id === 'scan' && state.hasRun);
            return (
              <li key={id} aria-current={current ? 'step' : undefined}>
                <Link
                  href={`/onboarding?step=${String(number)}`}
                  className="group flex flex-col gap-2"
                >
                  <span
                    className={cn(
                      'h-1 rounded-full bg-muted transition-colors',
                      done && 'bg-brand/50',
                      current && 'bg-brand',
                    )}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      'flex items-center gap-1 truncate text-xs text-muted-foreground group-hover:text-foreground',
                      current && 'font-medium text-foreground',
                    )}
                  >
                    {done && !current ? <Check className="size-3 text-brand" aria-hidden /> : null}
                    <span className="hidden sm:inline">{name}</span>
                    <span className="sm:hidden">{number}</span>
                    {done ? <span className="sr-only"> (done)</span> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      {blockedBy ? (
        <Banner tone="warning">
          {label(blockedBy.wanted)} needs the {label(blockedBy.needed)} step first.
        </Banner>
      ) : null}
      {show('ai') && settings ? (
        <StepAi settings={settings} ready={state.aiReady} demo={state.demo} />
      ) : null}
      {show('account') && settings ? (
        <StepAccount settings={settings} now={now} demo={state.demo} />
      ) : null}
      {show('product') ? <StepProduct existing={state.product} demo={state.demo} /> : null}
      {show('subreddits') && state.product ? (
        <StepSubreddits productId={state.product.id} saved={state.subreddits} />
      ) : null}
      {show('scan') && state.product ? (
        <StepScan
          productId={state.product.id}
          productName={state.product.name}
          subredditCount={state.subreddits.length}
        />
      ) : null}
    </div>
  );
}
