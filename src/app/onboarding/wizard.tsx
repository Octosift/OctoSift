'use client';

import { Check, Minus } from 'lucide-react';
import Link from 'next/link';
import { Banner } from '../components/ui/display';
import { cn } from '../components/ui/utils';
import type { SettingsData } from '../lib/data/settings';
import { StepAccount } from './step-account';
import { StepAi } from './step-ai';
import { StepProduct } from './step-product';
import { StepScan } from './step-scan';
import { StepSubreddits } from './step-subreddits';
import { STEPS, stepNumber } from './steps';

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
  blocked,
}: {
  step: number;
  state: OnboardingState;
  settings: SettingsData | null;
  now: number;
  blocked: boolean;
}) {
  const show = (id: Parameters<typeof stepNumber>[0]) => step === stepNumber(id);
  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Progress">
        {STEPS.map(({ id, label }, index) => {
          const number = index + 1;
          const current = number === step;
          // Passing the account step without connecting skips it rather than finishing it.
          const skipped =
            id === 'account' && number < step && !state.accountConnected && !state.demo;
          const done = number < step && !skipped;
          return (
            <li key={id} aria-current={current ? 'step' : undefined}>
              <Link
                href={`/onboarding?step=${number}`}
                className={cn(
                  'flex items-center gap-2 text-[13px] text-muted-foreground',
                  current && 'font-medium text-foreground',
                  number > step && 'pointer-events-none',
                )}
                aria-disabled={number > step ? true : undefined}
                tabIndex={number > step ? -1 : undefined}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border border-border text-[11px] tabular',
                    current && 'border-brand bg-brand text-brand-foreground',
                    done && 'border-brand text-brand',
                  )}
                >
                  {done ? (
                    <Check className="size-3" aria-hidden />
                  ) : skipped ? (
                    <Minus className="size-3" aria-hidden />
                  ) : (
                    number
                  )}
                </span>
                {label}
                {skipped ? <span className="sr-only"> (skipped)</span> : null}
              </Link>
            </li>
          );
        })}
      </ol>
      {blocked ? (
        <Banner tone="warning">Finish this step first; the next one depends on it.</Banner>
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
        <StepScan productId={state.product.id} productName={state.product.name} />
      ) : null}
    </div>
  );
}
