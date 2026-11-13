'use client';

import { Activity, Hash, Inbox, Package, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from './ui/utils';

const ITEMS = [
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/subreddits', label: 'Subreddits', icon: Hash },
  { href: '/product', label: 'Product', icon: Package },
  { href: '/runs', label: 'Runs', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function Nav({ toDo }: { toDo: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-0.5 md:flex-col">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground',
              active && 'bg-muted font-medium text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
            {href === '/inbox' && toDo > 0 ? (
              <span
                className="ml-auto hidden rounded-sm bg-brand-subtle px-1.5 text-[11px] font-medium text-brand-subtle-foreground tabular md:inline"
                aria-label={`${String(toDo)} leads to do`}
              >
                {toDo}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
