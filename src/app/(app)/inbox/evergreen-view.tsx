'use client';

import { ExternalLink, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { SerpThreadRow } from '@/core/db/queries/serp';
import { Button } from '../../components/ui/button';
import { Badge, Banner, Card, CardHeader, EmptyState } from '../../components/ui/display';
import { Select, Textarea } from '../../components/ui/fields';
import { cn } from '../../components/ui/utils';
import { checkEvergreenNow, saveEvergreenKeywords } from '../../lib/actions/evergreen';
import type { EvergreenData } from '../../lib/data/evergreen';
import { formatAgo, formatExactUsd } from '../../lib/format';
import { InboxTabs } from './inbox-tabs';
import { inboxHref } from './url';

type Message = { tone: 'info' | 'danger'; text: string } | null;

const RUN_STATUS = {
  ok: { label: 'Finished', tone: 'brand' },
  partial: { label: 'Partly finished', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  running: { label: 'Running', tone: 'neutral' },
} as const;

const WEEK_S = 7 * 86_400;

function groupByKeyword(threads: SerpThreadRow[], keywords: string[]) {
  const groups = new Map<string, SerpThreadRow[]>(keywords.map((keyword) => [keyword, []]));
  for (const thread of threads)
    groups.set(thread.keyword, [...(groups.get(thread.keyword) ?? []), thread]);
  // Threads worth answering first; archived ones stay visible at the end, labelled.
  return [...groups.entries()]
    .map(([keyword, rows]) => ({
      keyword,
      rows: [...rows].sort((a, b) => Number(a.archived) - Number(b.archived) || a.rank - b.rank),
    }))
    .filter((group) => group.rows.length > 0);
}

function ThreadRow({ thread, now }: { thread: SerpThreadRow; now: number }) {
  return (
    <li className={cn('flex gap-3 px-4 py-2.5', thread.archived && 'opacity-60')}>
      <Badge
        tone={thread.archived ? 'outline' : 'brand'}
        className="mt-px w-9 self-start justify-center tabular"
        aria-label={`Rank ${String(thread.rank)} on Google`}
      >
        #{thread.rank}
      </Badge>
      <div className="min-w-0 flex-1">
        <a
          href={thread.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 font-medium hover:underline"
        >
          <span className="truncate">{thread.title || thread.url}</span>
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </a>
        <p className="mt-0.5 text-xs text-muted-foreground">
          r/{thread.subreddit}
          <span aria-hidden> · </span>
          {thread.publishedAt !== null
            ? `posted ${formatAgo(thread.publishedAt, now)}`
            : 'date not shown on Google'}
        </p>
      </div>
      {thread.archived ? (
        <Badge tone="outline" className="self-start">
          Archived, replies closed
        </Badge>
      ) : null}
    </li>
  );
}

function KeywordsCard({ data }: { data: EvergreenData }) {
  const [value, setValue] = useState(data.usingBuyerPhrases ? '' : data.keywords.join('\n'));
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <CardHeader
        title="Keywords"
        description={`What your buyers search for, one per line, up to ${String(data.maxKeywords)}.`}
      />
      <form
        className="flex flex-col gap-2 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await saveEvergreenKeywords({
              productId: data.product.id,
              keywords: value,
            });
            setMessage(
              result.ok
                ? { tone: 'info', text: result.message }
                : { tone: 'danger', text: result.error },
            );
          });
        }}
      >
        <label htmlFor="evergreen-keywords" className="sr-only">
          Keywords to check
        </label>
        <Textarea
          id="evergreen-keywords"
          rows={7}
          value={value}
          placeholder={data.keywords.join('\n')}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        {data.usingBuyerPhrases ? (
          <p className="text-xs text-muted-foreground">
            Empty: your product&apos;s buyer phrases are used, as shown.
          </p>
        ) : null}
        {message ? (
          <p
            role={message.tone === 'danger' ? 'alert' : 'status'}
            className={cn(
              'text-xs',
              message.tone === 'danger' ? 'text-danger-foreground' : 'text-muted-foreground',
            )}
          >
            {message.text}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending}>
            Save keywords
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ChecksCard({ data }: { data: EvergreenData }) {
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();
  const last = data.runs[0];
  const nextCheck = last ? last.startedAt + WEEK_S : null;
  return (
    <Card>
      <CardHeader
        title="Checks"
        description={
          nextCheck !== null && nextCheck > data.now
            ? `Weekly. Next check ${new Date(nextCheck * 1000).toLocaleDateString()}.`
            : 'Weekly, or whenever you press Check now.'
        }
      />
      <div className="flex flex-col gap-3 px-4 py-3">
        <Button
          variant="brand"
          disabled={pending || data.running}
          onClick={() => {
            startTransition(async () => {
              const result = await checkEvergreenNow({ productId: data.product.id });
              setMessage(
                result.ok
                  ? { tone: 'info', text: result.message }
                  : { tone: 'danger', text: result.error },
              );
            });
          }}
        >
          <RefreshCw aria-hidden className={cn(pending && 'animate-spin')} />
          {pending || data.running ? 'Checking…' : 'Check now'}
        </Button>
        {message ? (
          <p
            role={message.tone === 'danger' ? 'alert' : 'status'}
            className={cn(
              'text-xs',
              message.tone === 'danger' ? 'text-danger-foreground' : 'text-muted-foreground',
            )}
          >
            {message.text}
          </p>
        ) : null}
        {data.runs.length > 0 ? (
          <table className="w-full text-xs">
            <caption className="sr-only">Recent checks and their cost</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 text-left font-medium">
                  When
                </th>
                <th scope="col" className="py-1 text-left font-medium">
                  Status
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Threads
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id} title={run.error ?? undefined}>
                  <td className="py-1">{formatAgo(run.startedAt, data.now)}</td>
                  <td className="py-1">
                    <Badge tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Badge>
                  </td>
                  <td className="py-1 text-right tabular">{run.threads}</td>
                  <td className="py-1 text-right tabular">{formatExactUsd(run.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {last?.error ? <Banner tone="warning">{last.error}</Banner> : null}
      </div>
    </Card>
  );
}

export function EvergreenView({ data }: { data: EvergreenData }) {
  const router = useRouter();
  const groups = groupByKeyword(data.threads, data.keywords);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <InboxTabs active="evergreen" counts={data.counts} evergreen={data.evergreen} />
      <div className="grid items-start gap-5 px-6 py-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="evergreen-heading" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="evergreen-heading" className="text-[15px] font-semibold">
                Threads that rank on Google
              </h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                People searching these phrases land on these threads for months, so a helpful reply
                keeps being read.
                {data.checkedAt !== null ? ` Checked ${formatAgo(data.checkedAt, data.now)}.` : ''}
              </p>
            </div>
            {data.products.length > 1 ? (
              <Select
                aria-label="Product"
                className="h-8 w-auto"
                value={data.product.id}
                onChange={(event) => {
                  router.push(inboxHref({}, { tab: 'evergreen', product: event.target.value }));
                }}
              >
                {data.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          {groups.length === 0 ? (
            <Card>
              <EmptyState
                title={
                  data.checkedAt === null
                    ? 'Not checked yet'
                    : 'No Reddit threads rank for these keywords'
                }
              >
                {data.checkedAt === null
                  ? 'Press Check now to look up your keywords, or wait for the weekly check.'
                  : 'Try phrases closer to what buyers type, such as "best invoicing app for freelancers".'}
              </EmptyState>
            </Card>
          ) : (
            groups.map((group) => (
              <Card key={group.keyword}>
                <CardHeader
                  title={`“${group.keyword}”`}
                  description={`${String(group.rows.filter((row) => !row.archived).length)} open, ${String(group.rows.filter((row) => row.archived).length)} archived`}
                />
                <ul className="divide-y divide-border text-[13px]">
                  {group.rows.map((thread) => (
                    <ThreadRow key={thread.id} thread={thread} now={data.now} />
                  ))}
                </ul>
              </Card>
            ))
          )}
        </section>
        <aside className="flex flex-col gap-4 xl:sticky xl:top-5">
          <ChecksCard data={data} />
          <KeywordsCard data={data} />
        </aside>
      </div>
    </div>
  );
}
