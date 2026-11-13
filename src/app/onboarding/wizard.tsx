'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { Banner } from '../components/ui/display';
import { cn } from '../components/ui/utils';
import type { SettingsData } from '../lib/data/settings';
import { StepAi } from './step-ai';
import { StepProduct } from './step-product';
import { StepScan } from './step-scan';
import { StepSubreddits } from './step-subreddits';

export interface OnboardingState {
  aiReady: boolean;
  product: { id: string; name: string; url: string } | null;
  subreddits: string[];
  hasRun: boolean;
  demo: boolean;
}

const STEPS = ['AI provider', 'Product', 'Subreddits', 'First scan'];

export function Wizard({
  step,
  state,
  settings,
  blocked,
}: {
  step: number;
  state: OnboardingState;
  settings: SettingsData | null;
  blocked: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Progress">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const done = number < step;
          const current = number === step;
          return (
            <li key={label} aria-current={current ? 'step' : undefined}>
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
                  {done ? <Check className="size-3" aria-hidden /> : number}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ol>
      {blocked ? (
        <Banner tone="warning">Finish this step first; the next one depends on it.</Banner>
      ) : null}
      {step === 1 && settings ? (
        <StepAi settings={settings} ready={state.aiReady} demo={state.demo} />
      ) : null}
      {step === 2 ? <StepProduct existing={state.product} demo={state.demo} /> : null}
      {step === 3 && state.product ? (
        <StepSubreddits productId={state.product.id} saved={state.subreddits} />
      ) : null}
      {step === 4 && state.product ? (
        <StepScan productId={state.product.id} productName={state.product.name} />
      ) : null}
    </div>
  );
}
