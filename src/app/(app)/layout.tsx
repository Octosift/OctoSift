import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { BRAND } from '@/core/brand';
import { HealthBanners } from '../components/health-banners';
import { Nav } from '../components/nav';
import { ScanButton } from '../components/scan-button';
import { ThemeToggle } from '../components/theme-toggle';
import { Badge, Kbd } from '../components/ui/display';
import { loadShell } from '../lib/data/shell';
import { formatAgo } from '../lib/format';

export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: ReactNode }) {
  const shell = loadShell();
  if (shell.products.length === 0) redirect('/onboarding');

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-3 border-b border-border bg-surface-raised px-3 py-3 md:sticky md:top-0 md:h-dvh md:w-52 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 px-2">
          <Link href="/inbox" className="text-sm font-semibold tracking-tight">
            {BRAND.name}
          </Link>
          {shell.demo ? <Badge tone="brand">Demo</Badge> : null}
        </div>
        <Nav toDo={shell.toDo} />
        <div className="mt-auto hidden flex-col gap-2 md:flex">
          <ScanButton state={shell.scan} />
          <p className="px-1 text-xs text-muted-foreground">
            {shell.lastRun ? (
              <>
                Last scan{' '}
                <Link href={`/runs/${shell.lastRun.id}`} className="hover:underline">
                  {formatAgo(shell.lastRun.startedAt, shell.now)}
                </Link>
              </>
            ) : (
              'No scans yet'
            )}
          </p>
          <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>?</Kbd> shortcuts
            </span>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <HealthBanners issues={shell.health} />
        {children}
      </main>
    </div>
  );
}
