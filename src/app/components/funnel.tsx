import type { FunnelCounts } from '@/core/pipeline/funnel';
import { cn } from './ui/utils';

export type FunnelStepKey = 'fetched' | 'filtered' | 'triage' | 'qualify' | 'leads' | 'drafts';

export interface FunnelStep {
  key: FunnelStepKey;
  label: string;
  value: number;
  hint: string;
  /** A drop-off rather than what remains: drawn dashed and shown as a minus. */
  drop?: boolean;
}

export function funnelSteps(counts: FunnelCounts): FunnelStep[] {
  return [
    { key: 'fetched', label: 'Read', value: counts.fetched, hint: 'Posts in the feeds' },
    {
      key: 'filtered',
      label: 'Filtered out',
      // Seen before, too old for a first read, or stopped by the free checks.
      value: Math.max(0, counts.fetched - counts.prefilter.pass),
      hint: 'Seen before or stopped by free checks',
      drop: true,
    },
    {
      key: 'triage',
      label: 'Triaged',
      value: counts.triage.pass,
      hint: 'Kept by the cheap model screen',
    },
    {
      key: 'qualify',
      label: 'Qualified',
      value: counts.qualify.pass,
      hint: 'Judged by the strong model',
    },
    { key: 'leads', label: 'Leads', value: counts.leads, hint: 'Added to your inbox' },
    {
      key: 'drafts',
      label: 'Drafts',
      value: counts.drafts.reply,
      hint: 'Reviewed replies ready to post',
    },
  ];
}

function percentOf(value: number, total: number): string {
  if (total === 0) return '';
  const share = (value / total) * 100;
  return share > 0 && share < 1 ? '<1%' : `${String(Math.round(share))}%`;
}

/**
 * The scan funnel: one centred bar per stage, scaled to the posts read, so
 * the shape narrows as posts drop out. Each stage can link to its posts.
 */
export function Funnel({
  counts,
  hrefFor,
  showHints = false,
  className,
}: {
  counts: FunnelCounts;
  hrefFor?: (step: FunnelStepKey) => string | null;
  /** Explain each stage under its label; for wider layouts. */
  showHints?: boolean;
  className?: string;
}) {
  const steps = funnelSteps(counts);
  const read = counts.fetched;
  const scale = Math.max(1, read, ...steps.map((step) => step.value));
  return (
    <ol className={cn('flex flex-col gap-2.5', className)} aria-label="Scan funnel">
      {steps.map((step) => {
        const href = hrefFor?.(step.key) ?? null;
        const width = step.value === 0 ? 0 : Math.max(3, (step.value / scale) * 100);
        const title = (
          <span
            className={cn('font-medium', step.drop ? 'text-muted-foreground' : 'text-foreground')}
          >
            {step.label}
          </span>
        );
        return (
          <li key={step.key} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between gap-3 text-xs">
              <span className="flex min-w-0 flex-col">
                {href ? (
                  <a href={href} className="hover:underline">
                    {title}
                  </a>
                ) : (
                  title
                )}
                {showHints ? (
                  <span className="truncate text-[11px] text-muted-foreground">{step.hint}</span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-baseline gap-2 tabular">
                <span className={step.drop ? 'text-muted-foreground' : 'font-medium'}>
                  {step.drop && step.value > 0 ? `−${String(step.value)}` : step.value}
                </span>
                {step.key !== 'fetched' && read > 0 ? (
                  <span className="w-9 text-right text-[11px] text-muted-foreground">
                    {percentOf(step.value, read)}
                  </span>
                ) : null}
              </span>
            </span>
            <span className="flex h-3 justify-center rounded-sm bg-muted/60" aria-hidden>
              <span
                className={cn(
                  'h-full rounded-sm',
                  width === 0 && 'hidden',
                  step.drop
                    ? 'border border-dashed border-muted-foreground/50 bg-transparent'
                    : step.key === 'leads' || step.key === 'drafts'
                      ? 'bg-brand'
                      : 'bg-foreground/30',
                )}
                style={{ width: `${String(width)}%` }}
              />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
