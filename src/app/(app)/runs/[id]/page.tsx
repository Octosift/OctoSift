import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { evaluationsForRun } from '@/core/db/queries/evaluations';
import { getRun } from '@/core/db/queries/runs';
import { emptyCounts, type FunnelCounts } from '@/core/pipeline/funnel';
import { Funnel } from '../../../components/funnel';
import {
  Badge,
  Banner,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
} from '../../../components/ui/display';
import { cn } from '../../../components/ui/utils';
import { formatUsd } from '../../../lib/format';
import { getRuntime } from '../../../lib/runtime';
import { formatDuration, RunStatus, TRIGGER_LABELS } from '../run-status';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Run' };

const STAGES = {
  prefilter: 'Filters',
  triage: 'Triage',
  qualify: 'Qualify',
  veto: 'Veto and score',
} as const;
type Stage = keyof typeof STAGES;

const FUNNEL_STAGE: Record<string, Stage | null> = {
  fetched: null,
  prefilter: 'prefilter',
  triage: 'triage',
  qualify: 'qualify',
  leads: 'veto',
};

const VERDICT_TONE = { pass: 'brand', skip: 'neutral', error: 'danger' } as const;

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  const { id } = await params;
  const stage = z
    .enum(['prefilter', 'triage', 'qualify', 'veto'])
    .catch('prefilter')
    .parse((await searchParams).stage);
  const { db } = getRuntime();
  const run = getRun(db, id);
  if (!run) notFound();
  const counts: FunnelCounts = { ...emptyCounts(), ...(run.countsJson as Partial<FunnelCounts>) };
  const entries = evaluationsForRun(db, run.id, stage);
  const reasons = new Map<string, number>();
  if (stage === 'prefilter') {
    for (const entry of entries) {
      if (entry.verdict === 'skip') reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
    }
  }

  return (
    <>
      <PageHeader
        title={`Scan of ${new Date(run.startedAt * 1000).toLocaleString()}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <RunStatus status={run.status} />
            {run.dryRun ? <Badge tone="outline">Dry run</Badge> : null}
            <span>{TRIGGER_LABELS[run.trigger] ?? run.trigger}</span>
            <span aria-hidden>·</span>
            <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
            <span aria-hidden>·</span>
            <span className="tabular">{formatUsd(run.costUsd, run.costIncomplete)}</span>
          </span>
        }
        actions={
          <Link href="/runs" className="text-[13px] text-muted-foreground hover:text-foreground">
            All runs
          </Link>
        }
      />
      <div className="grid gap-6 px-6 py-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {run.error ? (
            <Banner tone={run.status === 'failed' ? 'danger' : 'warning'}>{run.error}</Banner>
          ) : null}
          {counts.blocked ? (
            <Banner tone="warning">Reddit paused reads during this scan.</Banner>
          ) : null}
          <Card>
            <CardHeader title="Funnel" description="Select a stage to see its posts and reasons." />
            <div className="px-4 py-4">
              <Funnel
                counts={counts}
                hrefFor={(key) => {
                  const target = FUNNEL_STAGE[key];
                  return target ? `/runs/${run.id}?stage=${target}` : null;
                }}
              />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border px-4 py-3 text-xs">
              <dt className="text-muted-foreground">New posts</dt>
              <dd className="text-right tabular">{counts.new}</dd>
              <dt className="text-muted-foreground">Brand mentions</dt>
              <dd className="text-right tabular">{counts.brandMentions}</dd>
              <dt className="text-muted-foreground">Drafts and messages</dt>
              <dd className="text-right tabular">
                {counts.drafts.reply} + {counts.drafts.dm}
              </dd>
              <dt className="text-muted-foreground">Errors (retried next scan)</dt>
              <dd className="text-right tabular">{counts.triage.error + counts.qualify.error}</dd>
            </dl>
          </Card>
        </div>
        <Card className="min-w-0">
          <nav
            aria-label="Stages"
            className="flex gap-1 overflow-x-auto border-b border-border px-3"
          >
            {(Object.keys(STAGES) as Stage[]).map((key) => (
              <Link
                key={key}
                href={`/runs/${run.id}?stage=${key}`}
                aria-current={key === stage ? 'page' : undefined}
                className={cn(
                  '-mb-px shrink-0 border-b-2 border-transparent px-2 py-2 text-[13px] text-muted-foreground hover:text-foreground',
                  key === stage && 'border-brand font-medium text-foreground',
                )}
              >
                {STAGES[key]}
              </Link>
            ))}
          </nav>
          {reasons.size > 0 ? (
            <p className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2 text-xs">
              {[...reasons.entries()].map(([reason, total]) => (
                <Badge key={reason} tone="outline">
                  {reason.replace(/_/g, ' ')}: {total}
                </Badge>
              ))}
            </p>
          ) : null}
          {entries.length === 0 ? (
            <EmptyState title="Nothing at this stage">
              No posts reached this stage in this scan.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <li key={`${entry.productId}:${entry.postId}`} className="flex gap-3 px-4 py-2.5">
                  <Badge
                    tone={VERDICT_TONE[entry.verdict as keyof typeof VERDICT_TONE]}
                    className="mt-0.5 self-start"
                  >
                    {entry.verdict}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate font-medium hover:underline"
                    >
                      {entry.title}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      r/{entry.subreddit}
                      {entry.model ? ` · ${entry.model}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs">{entry.reason.replace(/_/g, ' ')}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
