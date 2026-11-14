'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { InboxRow } from '@/core/db/queries/inbox';
import { Badge } from '../../components/ui/display';
import { cn } from '../../components/ui/utils';
import { formatAge } from '../../lib/format';
import { intentLabel, scoreTone } from '../../lib/text';
import { inboxHref } from './url';

/** Quieter as the score drops: tinted, then grey, then outlined. */
const SCORE_BADGE = { strong: 'brand', brand: 'neutral', neutral: 'outline' } as const;

export function ScoreBadge({ score, kind }: { score: number; kind: string }) {
  if (kind === 'brand_mention') {
    return (
      <Badge tone="outline" className="mt-px w-8 shrink-0 self-start justify-center">
        @
      </Badge>
    );
  }
  return (
    <Badge
      tone={SCORE_BADGE[scoreTone(score)]}
      className="mt-px w-8 shrink-0 self-start justify-center tabular"
      aria-label={`Score ${String(score)}`}
    >
      {score}
    </Badge>
  );
}

export function LeadList({
  rows,
  selectedId,
  now,
}: {
  rows: InboxRow[];
  selectedId: string | null;
  now: number;
}) {
  const searchParams = useSearchParams();
  const selectedRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <ul aria-label="Leads" className="flex flex-col">
      {rows.map((row) => {
        const selected = row.id === selectedId;
        return (
          <li key={row.id}>
            <Link
              ref={selected ? selectedRef : undefined}
              href={inboxHref(searchParams, { lead: row.id })}
              scroll={false}
              aria-current={selected ? 'true' : undefined}
              data-lead-id={row.id}
              className={cn(
                'relative flex gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-surface-raised',
                selected &&
                  'bg-muted before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-brand hover:bg-muted',
              )}
            >
              <ScoreBadge score={row.score} kind={row.kind} />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular">
                    {formatAge(now - row.postCreatedAt)}
                  </span>
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">r/{row.subreddit}</span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">
                    {row.kind === 'brand_mention' ? 'Brand mention' : intentLabel(row.intent)}
                  </span>
                  {row.status === 'drafted' ? (
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-brand-subtle-foreground">
                      <span className="size-1.5 rounded-full bg-brand" aria-hidden />
                      Draft ready
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 line-clamp-1 text-[13px] text-muted-foreground">{row.reason}</p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
