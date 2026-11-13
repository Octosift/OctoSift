'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { emptyCounts } from '@/core/pipeline/funnel';
import { Funnel } from '../components/funnel';
import { Button } from '../components/ui/button';
import { Banner, Card, CardHeader } from '../components/ui/display';
import {
  completeOnboarding,
  firstScanProgress,
  startFirstScan,
  type ScanProgress,
} from '../lib/actions/onboarding';

export function StepScan({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter();
  const [since, setSince] = useState<number | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [waitedS, setWaitedS] = useState(0);
  const [pending, startTransition] = useTransition();
  const running =
    since !== null && progress?.status !== undefined
      ? progress.status === 'running'
      : since !== null;
  const finished = progress !== null && progress.status !== 'running';

  useEffect(() => {
    if (since === null || finished) return;
    const timer = setInterval(() => {
      setWaitedS((seconds) => seconds + 2);
      void firstScanProgress(since).then(setProgress);
    }, 2_000);
    return () => {
      clearInterval(timer);
    };
  }, [since, finished]);

  return (
    <section aria-labelledby="step-scan" className="flex flex-col gap-4">
      <div>
        <h2 id="step-scan" className="text-sm font-semibold">
          Run the first scan
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          The first scan reads posts from the last two days in each subreddit. Reading is slow on
          purpose (about one request a minute) so Reddit does not block you; the AI stages take a
          few seconds per post.
        </p>
      </div>
      <Card>
        <CardHeader
          title={
            finished
              ? 'First scan finished'
              : running
                ? 'Scanning…'
                : `Ready to scan for ${productName}`
          }
          actions={
            since === null ? (
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
          <Funnel counts={progress?.counts ?? emptyCounts()} />
        </div>
      </Card>
      {since !== null && progress === null && waitedS >= 20 ? (
        <Banner tone="warning">
          Waiting for the worker to start the scan. It runs alongside the dashboard when you start
          with pnpm dev, pnpm start or Docker.
        </Banner>
      ) : null}
      {finished && progress.error ? (
        <Banner tone={progress.status === 'failed' ? 'danger' : 'warning'}>
          {progress.error}{' '}
          <Link className="underline underline-offset-2" href="/settings">
            Open Settings
          </Link>
        </Banner>
      ) : null}
      <div className="flex justify-end gap-2">
        {finished || since === null ? (
          <Button
            variant={finished ? 'primary' : 'ghost'}
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                await completeOnboarding();
                router.push('/inbox');
              });
            }}
          >
            {finished ? 'Open the inbox' : 'Skip and open the inbox'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
