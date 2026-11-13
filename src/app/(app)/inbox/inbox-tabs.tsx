'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { InboxTab } from '@/core/db/queries/inbox';
import { cn } from '../../components/ui/utils';
import { inboxHref } from './url';

const TABS: { tab: InboxTab; label: string }[] = [
  { tab: 'new', label: 'New' },
  { tab: 'drafted', label: 'Drafted' },
  { tab: 'replied', label: 'Replied' },
  { tab: 'snoozed', label: 'Snoozed' },
  { tab: 'dismissed', label: 'Dismissed' },
  { tab: 'brand', label: 'Mentions' },
];

export function InboxTabs({
  active,
  counts,
}: {
  active: InboxTab;
  counts: Record<InboxTab, number>;
}) {
  const searchParams = useSearchParams();
  return (
    <nav
      aria-label="Lead status"
      className="flex gap-0.5 overflow-x-auto border-b border-border px-2"
    >
      {TABS.map(({ tab, label }) => (
        <Link
          key={tab}
          href={inboxHref(searchParams, { tab, lead: null, page: null })}
          aria-current={tab === active ? 'page' : undefined}
          className={cn(
            '-mb-px flex shrink-0 items-center gap-1 border-b-2 border-transparent px-1.5 py-2 text-[13px] text-muted-foreground hover:text-foreground',
            tab === active && 'border-brand font-medium text-foreground',
          )}
        >
          {label}
          <span className="text-[11px] tabular text-muted-foreground">{counts[tab]}</span>
        </Link>
      ))}
    </nav>
  );
}
