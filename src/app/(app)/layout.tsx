import { MessagesSquare } from 'lucide-react';
import Link from 'next/link';
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

/** The dashboard shell. Nothing here forces setup: Home shows what is left to do. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const shell = loadShell();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-5 border-b border-border px-3 py-3 md:sticky md:top-0 md:h-dvh md:w-60 md:border-r md:border-b-0 md:px-4 md:py-5">
        <div className="flex items-center justify-between gap-2 px-1">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessagesSquare className="size-4" aria-hidden />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">{BRAND.name}</span>
          </Link>
          <div className="flex items-center gap-1">
            {shell.demo ? <Badge tone="brand">Demo</Badge> : null}
            <span className="md:hidden">
              <ThemeToggle />
            </span>
          </div>
        </div>
        <Nav toDo={shell.toDo} />
        <div className="mt-auto hidden flex-col gap-3 md:flex">
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
          <div className="flex items-center justify-between border-t border-border px-1 pt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Kbd>?</Kbd> shortcuts
            </span>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col md:h-dvh md:overflow-y-auto">
        <HealthBanners issues={shell.health} />
        {children}
      </main>
    </div>
  );
}
