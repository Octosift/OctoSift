import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { countRuns, getRun, recentRuns, type RunRow } from '@/core/db/queries/runs';
import { emptyCounts, type FunnelCounts } from '@/core/pipeline/funnel';
import { Button } from '../../components/ui/button';
import { Badge, Card, EmptyState, PageHeader } from '../../components/ui/display';
import { cn } from '../../components/ui/utils';
import { formatAgo } from '../../lib/format';
import { getRuntime, nowSeconds } from '../../lib/runtime';
import { RunFunnelCard } from './run-funnel-card';
import { formatDuration, RunCost, RunStatus, TRIGGER_LABELS } from './run-status';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Runs' };

const PAGE_SIZE = 25;

function countsOf(run: RunRow): FunnelCounts {
  return { ...emptyCounts(), ...(run.countsJson as Partial<FunnelCounts>) };
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; run?: string }>;
}) {
  const params = await searchParams;
  const page = z.coerce.number().int().min(1).catch(1).parse(params.page);
  const runParam = z.string().max(64).optional().catch(undefined).parse(params.run);
  const { db } = getRuntime();
  const total = countRuns(db);
  const runs = recentRuns(db, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  // The selected run; the newest on the page when none is chosen.
  const selected =
    runs.find((run) => run.id === runParam) ??
    (runParam ? getRun(db, runParam) : null) ??
    runs[0] ??
    null;
  const selectHref = (id: string) =>
    page > 1 ? `/runs?page=${String(page)}&run=${id}` : `/runs?run=${id}`;
  const now = nowSeconds();
  return (
    <>
      <PageHeader
        title="Runs"
        description="Every scan, what it read, what it found and what it cost."
      />
      <div className="grid items-start gap-5 px-6 py-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {selected ? (
          <div className="xl:sticky xl:top-5 xl:order-2">
            <RunFunnelCard run={selected} counts={countsOf(selected)} />
          </div>
        ) : null}
        <div className="min-w-0 xl:order-1">
          {runs.length === 0 ? (
            <EmptyState title="No scans yet">
              The worker scans on a schedule once subreddits are set up. You can also press Scan
              now.
            </EmptyState>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-left text-[13px]">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Started
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      Trigger
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      Duration
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      Read
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      New
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      Leads
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      Drafts
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {runs.map((run) => {
                    const counts = countsOf(run);
                    const isSelected = run.id === selected?.id;
                    return (
                      <tr
                        key={run.id}
                        aria-selected={isSelected}
                        className={cn(
                          'hover:bg-muted/50',
                          isSelected && 'bg-selection hover:bg-selection',
                        )}
                      >
                        <td className="px-4 py-2">
                          <Link
                            href={selectHref(run.id)}
                            scroll={false}
                            aria-current={isSelected ? 'true' : undefined}
                            className="font-medium hover:underline"
                          >
                            {formatAgo(run.startedAt, now)}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {new Date(run.startedAt * 1000).toLocaleString()}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <span className="flex flex-wrap gap-1">
                            <RunStatus status={run.status} />
                            {run.dryRun ? <Badge tone="outline">Dry run</Badge> : null}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {TRIGGER_LABELS[run.trigger] ?? run.trigger}
                        </td>
                        <td className="px-2 py-2 text-right tabular">
                          {formatDuration(run.startedAt, run.finishedAt)}
                        </td>
                        <td className="px-2 py-2 text-right tabular">{counts.fetched}</td>
                        <td className="px-2 py-2 text-right tabular">{counts.new}</td>
                        <td className="px-2 py-2 text-right tabular">{counts.leads}</td>
                        <td className="px-2 py-2 text-right tabular">{counts.drafts.reply}</td>
                        <td className="px-4 py-2 text-right tabular">
                          <RunCost
                            costUsd={run.costUsd}
                            dataCostUsd={run.dataCostUsd}
                            incomplete={run.costIncomplete}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
          {total > PAGE_SIZE ? (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span className="tabular">
                Page {page} of {Math.ceil(total / PAGE_SIZE)}
              </span>
              <div className="flex gap-1">
                {page > 1 ? (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/runs?page=${page - 1}`}>Newer</Link>
                  </Button>
                ) : null}
                {page * PAGE_SIZE < total ? (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/runs?page=${page + 1}`}>Older</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
