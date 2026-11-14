import Link from 'next/link';
import type { RunRow } from '@/core/db/queries/runs';
import type { FunnelCounts } from '@/core/pipeline/funnel';
import { Funnel, type FunnelStepKey } from '../../components/funnel';
import { Card, CardHeader } from '../../components/ui/display';
import { formatDuration, RunCost, RunStatus, TRIGGER_LABELS } from './run-status';

const STAGE_FOR_STEP: Record<FunnelStepKey, string | null> = {
  fetched: null,
  filtered: 'prefilter',
  triage: 'triage',
  qualify: 'qualify',
  leads: 'veto',
  drafts: null,
};

/** The funnel of one scan, shown next to the list of runs. */
export function RunFunnelCard({ run, counts }: { run: RunRow; counts: FunnelCounts }) {
  const started = new Date(run.startedAt * 1000).toLocaleString();
  return (
    <Card aria-label="Selected scan">
      <CardHeader
        title={`Scan of ${started}`}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RunStatus status={run.status} />
            <span>{TRIGGER_LABELS[run.trigger] ?? run.trigger}</span>
            <span aria-hidden>·</span>
            <span className="tabular">{formatDuration(run.startedAt, run.finishedAt)}</span>
            <span aria-hidden>·</span>
            <span className="tabular">
              <RunCost
                costUsd={run.costUsd}
                dataCostUsd={run.dataCostUsd}
                incomplete={run.costIncomplete}
                inline
              />
            </span>
          </span>
        }
      />
      <div className="px-4 py-4">
        <Funnel
          counts={counts}
          showHints
          hrefFor={(step) => {
            const stage = STAGE_FOR_STEP[step];
            return stage ? `/runs/${run.id}?stage=${stage}` : null;
          }}
        />
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-border px-4 py-3 text-xs">
        <dt className="text-muted-foreground">New posts stored</dt>
        <dd className="text-right tabular">{counts.new}</dd>
        <dt className="text-muted-foreground">Brand mentions</dt>
        <dd className="text-right tabular">{counts.brandMentions}</dd>
        <dt className="text-muted-foreground">Private message drafts</dt>
        <dd className="text-right tabular">{counts.drafts.dm}</dd>
        <dt className="text-muted-foreground">Errors (retried next scan)</dt>
        <dd className="text-right tabular">{counts.triage.error + counts.qualify.error}</dd>
      </dl>
      <div className="border-t border-border px-4 py-2.5">
        <Link
          href={`/runs/${run.id}`}
          className="text-[13px] font-medium text-brand-subtle-foreground hover:underline"
        >
          See every post and reason
        </Link>
      </div>
    </Card>
  );
}
