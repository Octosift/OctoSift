'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { requestScanAction } from '../lib/actions/scan';
import { Button } from './ui/button';

/**
 * Asks the worker for a scan. While a scan is requested or running, the
 * page refreshes every few seconds so results appear without a reload.
 */
export function ScanButton({ state }: { state: 'idle' | 'requested' | 'running' }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = pending || state !== 'idle';

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setInterval(() => {
      router.refresh();
    }, 3_000);
    return () => {
      clearInterval(timer);
    };
  }, [state, router]);

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-start"
      disabled={busy}
      onClick={() => {
        startTransition(async () => {
          await requestScanAction(null);
          router.refresh();
        });
      }}
    >
      <RefreshCw className={busy ? 'animate-spin' : undefined} aria-hidden />
      {state === 'running'
        ? 'Scanning…'
        : state === 'requested' || pending
          ? 'Starting scan…'
          : 'Scan now'}
    </Button>
  );
}
