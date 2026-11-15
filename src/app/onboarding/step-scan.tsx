'use client';

import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { emptyCounts } from '@/core/pipeline/funnel';
import { Funnel } from '../components/funnel';
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
): { text: string; tone: 'info' | 'warning'; pace?: boolean } {
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
  if (worker?.activity === 'reading') {
    const where = worker.detail ? `Reading ${worker.detail}` : 'Reading subreddits';
    const count =
      worker.total && worker.done !== null
        ? ` (${String(Math.min(worker.done + 1, worker.total))} of ${String(worker.total)})`
        : '';
    return { text: `${where}${count}…`, tone: 'info', pace: true };
  }
  if (worker?.activity === 'judging') {
    return { text: 'Judging the new posts with your AI model…', tone: 'info' };
  }
  return { text: 'Scanning…', tone: 'info' };
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
          <Funnel
            counts={run?.counts ?? emptyCounts()}
            reading={!finished && status?.worker?.activity === 'reading'}
          />
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
