import { ArrowRight, Check, CircleAlert, LoaderCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '../components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '../components/ui/display';
import { cn } from '../components/ui/utils';
import { loadHome, type HomeData, type SetupItem } from '../lib/data/home';
import { formatAge, formatAgo, formatUsd } from '../lib/format';
import { INTENT_LABELS } from '../lib/text';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Home' };

function SetupCard({ items }: { items: SetupItem[] }) {
  const done = items.filter((item) => item.done).length;
  const next = items.find((item) => !item.done);
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-4 px-5 pt-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Get started</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            About five minutes. Only the AI provider is required; skip anything and come back later.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
          <span className="tabular">
            {done} of {items.length} done
          </span>
          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span
              className="block h-full rounded-full bg-brand transition-[width]"
              style={{ width: `${String((done / items.length) * 100)}%` }}
            />
          </span>
        </div>
      </div>
      <ol className="mt-4 divide-y divide-border border-t border-border">
        {items.map((item, index) => (
          <li key={item.id} className="flex items-center gap-4 px-5 py-3.5">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-medium tabular',
                item.done
                  ? 'border-brand bg-brand text-brand-foreground'
                  : 'border-border text-muted-foreground',
              )}
              aria-hidden
            >
              {item.done ? <Check className="size-4" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'flex items-center gap-2 font-medium',
                  item.done && 'text-muted-foreground',
                )}
              >
                {item.title}
                {item.optional && !item.done ? <Badge tone="outline">Optional</Badge> : null}
                <span className="sr-only">{item.done ? '(done)' : ''}</span>
              </p>
              <p className="text-[13px] text-muted-foreground">{item.body}</p>
            </div>
            {item.done ? (
              <Link
                href={item.href}
                className="text-[13px] text-muted-foreground hover:text-foreground"
              >
                Change
              </Link>
            ) : (
              <Button asChild size="sm" variant={item.id === next?.id ? 'primary' : 'outline'}>
                <Link href={item.href}>{item.id === next?.id ? 'Start' : 'Set up'}</Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Stat({
  label,
  value,
  note,
  href,
}: {
  label: string;
  value: string;
  note?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </>
  );
  return (
    <Card className="px-4 py-3.5 sm:px-5 sm:py-4">
      {href ? (
        <Link href={href} className="block rounded-lg">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

function Stats({ data }: { data: HomeData }) {
  const { stats, lastRun, now } = data;
  const spend =
    stats.apiEquivalentThisWeekUsd !== null
      ? {
          value: 'Subscription',
          note: `≈ ${formatUsd(stats.apiEquivalentThisWeekUsd)} on the API`,
        }
      : { value: formatUsd(stats.spentThisWeekUsd), note: 'From the price table' };
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <Stat
        label="Waiting for a reply"
        value={String(stats.toDo)}
        note="Leads in your inbox"
        href="/inbox"
      />
      <Stat label="Replied this week" value={String(stats.repliedThisWeek)} />
      <Stat
        label="Last scan"
        value={lastRun ? formatAgo(lastRun.startedAt, now) : 'Not yet'}
        {...(lastRun
          ? {
              note: `${String(lastRun.fetched)} posts read${lastRun.status === 'ok' ? '' : ` · ${lastRun.status.replace('_', ' ')}`}`,
              href: `/runs/${lastRun.id}`,
            }
          : {})}
      />
      <Stat label="AI spend, last 7 days" value={spend.value} note={spend.note} />
    </div>
  );
}

function LeadsCard({ data }: { data: HomeData }) {
  return (
    <Card>
      <CardHeader
        title="Waiting for a reply"
        actions={
          <Link
            href="/inbox"
            className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Open the inbox <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      />
      {data.leads.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          No leads waiting. New ones appear after each scan.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {data.leads.map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/inbox?lead=${lead.id}`}
                className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-raised"
              >
                <span className="w-10 shrink-0 rounded-md bg-brand-subtle py-1 text-center text-[13px] font-semibold text-brand-subtle-foreground tabular">
                  {lead.score}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{lead.title}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    r/{lead.subreddit} · {formatAge(data.now - lead.postCreatedAt)} ·{' '}
                    {INTENT_LABELS[lead.intent] ?? lead.intent}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ScannerCard({ data }: { data: HomeData }) {
  const { worker } = data;
  const line =
    worker === null
      ? {
          icon: <CircleAlert className="size-4 text-warning-foreground" aria-hidden />,
          text: 'The worker is not running',
          note: 'Start the app with pnpm dev, pnpm start or Docker to scan.',
        }
      : worker.activity === 'reading'
        ? {
            icon: <LoaderCircle className="size-4 animate-spin text-brand" aria-hidden />,
            text: worker.detail ? `Reading ${worker.detail}` : 'Reading subreddits',
            note:
              worker.total !== null && worker.done !== null
                ? `${String(Math.min(worker.done + 1, worker.total))} of ${String(worker.total)}`
                : 'Scan in progress',
          }
        : worker.activity === 'judging'
          ? {
              icon: <LoaderCircle className="size-4 animate-spin text-brand" aria-hidden />,
              text: 'Judging new posts',
              note: 'Your AI model is reading them',
            }
          : worker.activity === 'checking'
            ? {
                icon: <LoaderCircle className="size-4 animate-spin text-brand" aria-hidden />,
                text: 'Checking subreddits',
                note: worker.detail ?? '',
              }
            : {
                icon: <span className="mx-1 size-2 rounded-full bg-brand" aria-hidden />,
                text: 'Waiting for the next scan',
                note: `Scans every ${String(data.intervalMinutes)} minutes`,
              };
  return (
    <Card>
      <CardHeader title="Scanner" />
      <div className="flex flex-col gap-4 px-5 py-4 text-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-5 items-center justify-center">{line.icon}</span>
          <div className="min-w-0">
            <p className="font-medium">{line.text}</p>
            {line.note ? <p className="text-[13px] text-muted-foreground">{line.note}</p> : null}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-[13px]">
          <div>
            <dt className="text-muted-foreground">Subreddits</dt>
            <dd className="font-medium tabular">
              <Link href="/subreddits" className="hover:underline">
                {data.subredditCount} watched
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reading</dt>
            <dd className="font-medium">
              {data.accountConnected ? 'Reddit account' : 'Logged out, slow'}
            </dd>
          </div>
        </dl>
        {!data.accountConnected ? (
          <p className="text-[13px] text-muted-foreground">
            Logged out, Reddit allows about one read a minute.{' '}
            <Link
              className="text-foreground underline underline-offset-2"
              href="/settings?tab=reddit"
            >
              Connect an account
            </Link>{' '}
            to read several times faster.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

export default function HomePage() {
  const data = loadHome();
  return (
    <>
      <PageHeader
        title="Home"
        description={
          data.product
            ? `Leads for ${data.product.name}, and what the scanner is doing.`
            : 'Find people on Reddit who need what you built. Start with the steps below.'
        }
      />
      <div className="flex max-w-6xl flex-col gap-6 px-6 pb-12">
        {!data.setupDone ? <SetupCard items={data.setup} /> : null}
        {data.product ? (
          <>
            <Stats data={data} />
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <LeadsCard data={data} />
              <ScannerCard data={data} />
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
