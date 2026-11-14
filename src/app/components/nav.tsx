'use client';

import { Activity, Hash, House, Inbox, Package, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from './ui/utils';

const ITEMS = [
  { href: '/', label: 'Home', icon: House },
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
        const active =
          href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              active && 'bg-surface font-medium text-foreground shadow-card ring-1 ring-border',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
            {href === '/inbox' && toDo > 0 ? (
              <span
                className="ml-auto hidden rounded-md bg-brand-subtle px-1.5 text-xs font-medium text-brand-subtle-foreground tabular md:inline"
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
