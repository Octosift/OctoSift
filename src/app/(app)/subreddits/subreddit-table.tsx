'use client';

import { ExternalLink, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import type { RulesSummary } from '@/core/ai/schemas';
import type { SubredditStats } from '@/core/db/queries/stats';
import type { ValidationProgress } from '@/core/validation-queue';
import { Button } from '../../components/ui/button';
import { Badge, Banner, Card } from '../../components/ui/display';
import { Input, Select } from '../../components/ui/fields';
import {
  addSubreddit,
  removeSubreddit,
  retrySubreddit,
  setPolicy,
  setReading,
  type SubredditActionResult,
} from '../../lib/actions/subreddits';
import { formatAgo, formatClock } from '../../lib/format';
import { RulesDialog, RulesSummaryLine } from './rules-dialog';

type Row = Omit<SubredditStats, 'rulesSummary'> & { rulesSummary: RulesSummary | null };

export function AddSubredditForm({ productId }: { productId: string }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex max-w-xl flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await addSubreddit({ productId, name });
          if (result.ok) {
            setName('');
            setError(null);
          } else {
            setError(result.error);
          }
        });
      }}
    >
      <div className="flex gap-2">
        <Input
          aria-label="Subreddit to add"
          placeholder="Add a subreddit, e.g. r/freelance"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" disabled={pending || name.trim() === ''}>
          Add
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger-foreground">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function StatusCell({
  row,
  now,
  check,
}: {
  row: Row;
  now: number;
  check: ValidationProgress['results'][number] | undefined;
}) {
  if (row.status === 'gone') return <Badge tone="danger">Not found</Badge>;
  if (!row.enabled) return <Badge tone="outline">Paused</Badge>;
  if (row.blockUntil !== null && row.blockUntil > now) {
    return <Badge tone="warning">Paused by Reddit until {formatClock(row.blockUntil)}</Badge>;
  }
  if (check?.status === 'gone') return <Badge tone="danger">Not found</Badge>;
  if (row.lastPolledAt === null) {
    return (
      <Badge tone="outline">
        {check?.status === 'ok' ? 'Checked, waiting for scan' : 'Waiting for first read'}
      </Badge>
    );
  }
  return <Badge tone="brand">Reading</Badge>;
}

export function SubredditTable({
  productId,
  rows,
  now,
  checks,
}: {
  productId: string;
  rows: Row[];
  now: number;
  checks: ValidationProgress['results'];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<SubredditActionResult>) => {
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : result.error);
    });
  };

  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-[13px]">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Subreddit
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Last read
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Posts a day
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Seen
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Leads
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Hit rate
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Promotion
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const check = checks.find((candidate) => candidate.name === row.name);
            const hitRate =
              row.postsSeen > 0 ? `${((row.leads / row.postsSeen) * 100).toFixed(1)}%` : '–';
            return (
              <tr key={row.name} className="align-top">
                <td className="px-4 py-2.5">
                  <a
                    href={`https://www.reddit.com/r/${row.name}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    r/{row.name}{' '}
                    <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
                  </a>
                  {row.rulesSummary ? (
                    <RulesSummaryLine
                      summary={row.rulesSummary}
                      updatedAt={row.rulesUpdatedAt}
                      now={now}
                    />
                  ) : null}
                  <div>
                    <RulesDialog name={row.name} text={row.rulesText} summary={row.rulesSummary} />
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <StatusCell row={row} now={now} check={check} />
                </td>
                <td className="px-2 py-2.5 text-muted-foreground">
                  {row.lastPolledAt ? formatAgo(row.lastPolledAt, now) : 'Never'}
                  {row.pollIntervalMinutes ? (
                    <span className="block text-xs">Busy: every {row.pollIntervalMinutes} min</span>
                  ) : null}
                </td>
                <td className="px-2 py-2.5 text-right tabular">{row.postsPerDay ?? '–'}</td>
                <td className="px-2 py-2.5 text-right tabular">{row.postsSeen}</td>
                <td className="px-2 py-2.5 text-right tabular">{row.leads}</td>
                <td className="px-2 py-2.5 text-right tabular">{hitRate}</td>
                <td className="px-2 py-2.5">
                  <Select
                    aria-label={`Promotion policy for r/${row.name}`}
                    className="h-7 w-auto text-xs"
                    value={row.promotionPolicy}
                    disabled={pending}
                    onChange={(event) => {
                      run(() => setPolicy({ name: row.name, policy: event.target.value }));
                    }}
                  >
                    <option value="unknown">Not sure</option>
                    <option value="allowed">Allowed with disclosure</option>
                    <option value="no_promotion">No promotion</option>
                  </Select>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    {row.status === 'gone' ? (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          run(() => retrySubreddit({ name: row.name }));
                        }}
                      >
                        Check again
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          run(() =>
                            setReading({ productId, name: row.name, enabled: !row.enabled }),
                          );
                        }}
                      >
                        {row.enabled ? 'Pause' : 'Resume'}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove r/${row.name}`}
                      disabled={pending}
                      onClick={() => {
                        run(() => removeSubreddit({ productId, name: row.name }));
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error ? (
        <Banner tone="danger" className="m-3" role="alert">
          {error}
        </Banner>
      ) : null}
    </Card>
  );
}
