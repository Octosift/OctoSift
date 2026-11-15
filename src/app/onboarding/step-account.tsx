'use client';

import { useRouter } from 'next/navigation';
import { RedditConnect } from '../(app)/settings/reddit-account';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/display';
import type { SettingsData } from '../lib/data/settings';
import { stepHref } from './steps';

export function StepAccount({
  settings,
  now,
  demo,
}: {
  settings: SettingsData;
  now: number;
  demo: boolean;
}) {
  const router = useRouter();
  const connected = settings.account.status === 'connected';
  const next = () => {
    router.push(stepHref('product'));
    router.refresh();
  };
  return (
    <section aria-labelledby="step-account" className="flex flex-col gap-4">
      <div>
        <h2 id="step-account" className="text-xl font-semibold tracking-tight">
          Connect a Reddit account
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Reading Reddit signed in is several times faster than reading logged out. Sign in through
          a browser window the app opens, or paste the session cookie if the app runs in Docker.
        </p>
      </div>
      <Card className="px-4 py-4">
        <RedditConnect account={settings.account} now={now} demo={demo} />
      </Card>
      {!connected && !demo ? (
        <p className="text-xs text-muted-foreground">
          You can skip this and connect an account later in Settings. Until then the app reads
          Reddit&apos;s public RSS feeds instead. Reddit is retiring them, so scans may find
          nothing.
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {connected || demo ? (
          <Button variant="primary" onClick={next}>
            Continue
          </Button>
        ) : (
          <Button variant="outline" onClick={next}>
            Skip for now
          </Button>
        )}
      </div>
    </section>
  );
}
