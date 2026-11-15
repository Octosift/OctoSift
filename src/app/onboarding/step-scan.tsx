'use client';

import { Check, Circle, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { FunnelCounts } from '@/core/pipeline/funnel';
import { Button } from '../components/ui/button';
import { Banner, Card, CardHeader } from '../components/ui/display';
import {
  completeOnboarding,
  scanStatus,
  startFirstScan,
  type ScanStatus,
} from '../lib/actions/onboarding';
import { stepHref } from './steps';

/** Rough minutes per subreddit read: one feed a minute logged out, a few pages with an account. */
const MINUTES_PER_READ = { account: 0.5, loggedOut: 1 };

function minutes(count: number): string {
  const rounded = Math.max(1, Math.round(count));
  return `${String(rounded)} ${rounded === 1 ? 'minute' : 'minutes'}`;
}

/** One line saying what is happening, from the worker's own report. */
function describe(
  status: ScanStatus | null,
  waitedS: number,
): { text: string; tone: 'info' | 'warning'; pace?: boolean } | null {
  if (status === null) return { text: 'Getting the scan ready…', tone: 'info' };
  const { run, worker } = status;
  if (run === null) {
    if (worker === null) {
      return waitedS >= 6
        ? {
            text: 'The scanner is not running, so the scan cannot start. Start the app with pnpm dev, pnpm start or Docker, and this page carries on by itself.',
            tone: 'warning',
          }
        : { text: 'Getting the scan ready…', tone: 'info' };
    }
    if (worker.activity === 'checking') {
      const progress = worker.total
        ? ` (${String(worker.done ?? 0)} of ${String(worker.total)})`
        : '';
      return {
        text: `The scanner is finishing a subreddit check${progress}. Your scan starts right after.`,
        tone: 'info',
      };
    }
    if (worker.activity !== 'idle') {
      return {
        text: 'Another scan is still running. Yours starts right after.',
        tone: 'info',
      };
    }
    return { text: 'Starting the scan…', tone: 'info' };
  }
  // Once the scan runs, the steps above show the progress; only reading needs a note.
  if (worker?.activity === 'reading') {
    return {
      text: 'Reading is the slow part: requests are spaced out so Reddit does not block you.',
      tone: 'info',
      pace: true,
    };
  }
  return null;
}

type StepState = 'waiting' | 'active' | 'done';

interface ScanStep {
  title: string;
  state: StepState;
  detail: string | null;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * The scan as three steps, from the worker's report and the counts the scan
 * writes as it goes. Drafts are written as each lead is found, so they share
 * the careful check's step.
 */
export function scanSteps(
  status: ScanStatus | null,
  started: boolean,
  finished: boolean,
): ScanStep[] {
  const counts: FunnelCounts | null = status?.run?.counts ?? null;
  const worker = status?.worker ?? null;
  const running = started && !finished && status !== null && status.run !== null;
  const reading = running && (worker === null || worker.activity === 'reading');
  const screened = counts ? counts.triage.pass + counts.triage.skip + counts.triage.error : 0;
  const checked = counts ? counts.qualify.pass + counts.qualify.error : 0;
  const judging = running && !reading;
  const screening = judging && screened === 0 && (counts?.prefilter.pass ?? 0) > 0;

  const readState: StepState = finished || judging ? 'done' : reading ? 'active' : 'waiting';
  const readDetail =
    reading && worker?.detail
      ? `${worker.detail}${worker.total ? `, ${String(Math.min((worker.done ?? 0) + 1, worker.total))} of ${String(worker.total)}` : ''}`
      : counts && readState !== 'waiting'
        ? `${plural(counts.fetched, 'post')} read, ${String(counts.new)} new. ${plural(counts.prefilter.skip, 'post')} skipped for free (seen before, too old or another language).`
        : null;

  const screenState: StepState =
    finished || (judging && !screening) ? 'done' : screening ? 'active' : 'waiting';
  const screenDetail =
    screenState === 'active'
      ? `A small model takes a first look at ${plural(counts?.prefilter.pass ?? 0, 'post')}.`
      : screenState === 'done' && counts
        ? `${String(counts.triage.pass)} of ${String(screened)} kept for a closer look.`
        : null;

  const checkState: StepState = finished ? 'done' : judging && !screening ? 'active' : 'waiting';
  const checkDetail =
    checkState === 'waiting' || !counts
      ? null
      : `${checkState === 'active' ? `${String(checked)} of ${String(counts.triage.pass)} checked. ` : ''}${plural(counts.leads, 'lead')} found, ${plural(counts.drafts.reply, 'reply', 'replies')} drafted.`;

  return [
    { title: 'Read new posts from your subreddits', state: readState, detail: readDetail },
    { title: 'Quick screen', state: screenState, detail: screenDetail },
    {
      title: 'Careful check, then drafts for the strongest leads',
      state: checkState,
      detail: checkDetail,
    },
  ];
}

function ScanSteps({ steps }: { steps: ScanStep[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step) => (
        <li key={step.title} className="flex items-start gap-3">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center" aria-hidden>
            {step.state === 'done' ? (
              <span className="flex size-5 items-center justify-center rounded-full bg-brand text-brand-foreground">
                <Check className="size-3.5" />
              </span>
            ) : step.state === 'active' ? (
              <LoaderCircle className="size-4 animate-spin text-brand" />
            ) : (
              <Circle className="size-4 text-border" />
            )}
          </span>
          <div className="min-w-0">
            <p
              className={
                step.state === 'waiting' ? 'text-sm text-muted-foreground' : 'text-sm font-medium'
              }
            >
              {step.title}
              <span className="sr-only">
                {step.state === 'done'
                  ? ' (done)'
                  : step.state === 'active'
                    ? ' (in progress)'
                    : ''}
              </span>
            </p>
            {step.detail ? (
              <p className="text-[13px] text-muted-foreground">{step.detail}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function missingNote(names: string[]): string {
  const one = names.length === 1;
  return `${names.map((name) => `r/${name}`).join(', ')} ${one ? 'does' : 'do'} not exist or ${
    one ? 'is' : 'are'
  } private, so ${one ? 'it was' : 'they were'} skipped. You can remove ${
    one ? 'it' : 'them'
  } on the Subreddits page.`;
}

export function StepScan({
  productId,
  productName,
  subredditCount,
}: {
  productId: string;
  productName: string;
  subredditCount: number;
}) {
  const router = useRouter();
  const [since, setSince] = useState<number | null>(null);
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [waitedS, setWaitedS] = useState(0);
  const [pending, startTransition] = useTransition();
  const run = status?.run ?? null;
  const finished = run !== null && run.status !== 'running';

  useEffect(() => {
    if (since === null || finished) return;
    const timer = setInterval(() => {
      setWaitedS((seconds) => seconds + 2);
      void scanStatus(productId, since).then(setStatus);
    }, 2_000);
    return () => {
      clearInterval(timer);
    };
  }, [productId, since, finished]);

  const line = since !== null && !finished ? describe(status, waitedS) : null;
  const worker = status?.worker ?? null;
  const left =
    worker?.activity === 'reading' && worker.total !== null && worker.done !== null
      ? (worker.total - worker.done) *
        (status?.accountConnected ? MINUTES_PER_READ.account : MINUTES_PER_READ.loggedOut)
      : null;

  return (
    <section aria-labelledby="step-scan" className="flex flex-col gap-4">
      <div>
        <h2 id="step-scan" className="text-xl font-semibold tracking-tight">
          Run the first scan
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {subredditCount === 0
            ? 'No subreddits are saved yet, so there is nothing to read. Add them on the Subreddits page later.'
            : 'Reads the last two days of posts, then the AI judges them. Reading is slow on purpose so Reddit does not block you.'}
        </p>
      </div>
      <Card>
        <CardHeader
          title={
            finished
              ? 'First scan finished'
              : since !== null
                ? 'Scanning…'
                : `Ready to scan for ${productName}`
          }
          actions={
            since === null && subredditCount > 0 ? (
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const { requestedAt } = await startFirstScan(productId);
                    setSince(requestedAt);
                  });
                }}
              >
                Start the first scan
              </Button>
            ) : null
          }
        />
        <div className="px-4 py-4">
          <ScanSteps steps={scanSteps(status, since !== null, finished)} />
        </div>
      </Card>
      {line ? (
        <Banner tone={line.tone} role="status">
          {line.tone === 'info' ? (
            <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
          ) : null}
          <span>
            {line.text}
            {line.pace && left !== null ? ` About ${minutes(left)} left.` : null}
            {line.pace && status && !status.accountConnected ? (
              <>
                {' '}
                Without a Reddit account, Reddit allows about one read a minute.{' '}
                <Link className="underline underline-offset-2" href={stepHref('account')}>
                  Connect an account
                </Link>{' '}
                to make reading several times faster.
              </>
            ) : null}
          </span>
        </Banner>
      ) : null}
      {finished && status && status.missing.length > 0 ? (
        <Banner tone="warning">{missingNote(status.missing)}</Banner>
      ) : null}
      {finished && run.error ? (
        <Banner tone={run.status === 'failed' ? 'danger' : 'warning'}>
          {run.error}{' '}
          <Link className="underline underline-offset-2" href="/settings">
            Open Settings
          </Link>
        </Banner>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {since !== null && !finished ? (
          <p className="text-xs text-muted-foreground">
            The scan keeps going in the background; leads appear in the inbox as they are found.
          </p>
        ) : null}
        <Button
          variant={finished ? 'primary' : 'ghost'}
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await completeOnboarding();
              router.push(since === null && !finished ? '/' : '/inbox');
            });
          }}
        >
          {finished ? 'Open the inbox' : since !== null ? 'Open the inbox now' : 'Skip for now'}
        </Button>
      </div>
    </section>
  );
}
