import type { FunnelCounts } from '@/core/pipeline/funnel';
import { cn } from './ui/utils';

export function funnelSteps(counts: FunnelCounts) {
  return [
    { key: 'fetched', label: 'Read', value: counts.fetched, hint: 'Posts in the feeds' },
    {
      key: 'prefilter',
      label: 'Kept by filters',
      value: counts.prefilter.pass,
      hint: 'Passed the free checks',
    },
    {
      key: 'triage',
      label: 'Triaged as relevant',
      value: counts.triage.pass,
      hint: 'Cheap model screen',
    },
    {
      key: 'qualify',
      label: 'Qualified',
      value: counts.qualify.pass,
      hint: 'Judged by the strong model',
    },
    { key: 'leads', label: 'Leads', value: counts.leads, hint: 'In your inbox' },
  ] as const;
}

/** Horizontal bars, one per stage, scaled to the first stage. */
export function Funnel({
  counts,
  hrefFor,
  className,
}: {
  counts: FunnelCounts;
  hrefFor?: (stage: string) => string | null;
  className?: string;
}) {
  const steps = funnelSteps(counts);
  const max = Math.max(1, ...steps.map((step) => step.value));
  return (
    <ol className={cn('flex flex-col gap-2', className)} aria-label="Scan funnel">
      {steps.map((step) => {
        const href = hrefFor?.(step.key) ?? null;
        const label = (
          <span className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium text-foreground">{step.label}</span>
            <span className="tabular text-muted-foreground">{step.value}</span>
          </span>
        );
        return (
          <li key={step.key} className="flex flex-col gap-1">
            {href ? (
              <a href={href} className="hover:underline">
                {label}
              </a>
            ) : (
              label
            )}
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              <span
                className={cn(
                  'block h-full rounded-full',
                  step.key === 'leads' ? 'bg-brand' : 'bg-foreground/30',
                )}
                style={{ width: `${Math.max(step.value > 0 ? 2 : 0, (step.value / max) * 100)}%` }}
              />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
