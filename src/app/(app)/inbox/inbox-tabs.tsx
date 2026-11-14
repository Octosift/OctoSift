'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { InboxTab } from '@/core/db/queries/inbox';
import { cn } from '../../components/ui/utils';
import { inboxHref } from './url';

/** Counts only where they ask for attention; the archive tabs stay quiet. */
const TABS: { tab: InboxTab; label: string; counted: boolean }[] = [
  { tab: 'todo', label: 'To do', counted: true },
  { tab: 'replied', label: 'Replied', counted: false },
  { tab: 'snoozed', label: 'Snoozed', counted: false },
  { tab: 'dismissed', label: 'Dismissed', counted: false },
  { tab: 'brand', label: 'Mentions', counted: true },
];

export function InboxTabs({
  active,
  counts,
  evergreen,
}: {
  active: InboxTab | 'evergreen';
  counts: Record<InboxTab, number>;
  /** Threads worth answering; null hides the tab until DataForSEO is set up. */
  evergreen: number | null;
}) {
  const tabs: { tab: InboxTab | 'evergreen'; label: string; count: number | null }[] = [
    ...TABS.map(({ tab, label, counted }) => ({
      tab,
      label,
      count: counted ? counts[tab] : null,
    })),
    ...(evergreen === null
      ? []
      : [{ tab: 'evergreen' as const, label: 'Evergreen', count: evergreen }]),
  ];
  const searchParams = useSearchParams();
  return (
    <nav
      aria-label="Lead status"
      className="no-scrollbar flex gap-3.5 overflow-x-auto border-b border-border px-4"
    >
      {tabs.map(({ tab, label, count }) => (
        <Link
          key={tab}
          href={inboxHref(searchParams, { tab, lead: null, page: null })}
          aria-current={tab === active ? 'page' : undefined}
          className={cn(
            '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 border-transparent py-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground',
            tab === active && 'border-foreground font-medium text-foreground',
          )}
        >
          {label}
          {count === null ? null : (
            <span className="text-xs tabular text-muted-foreground">{count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
