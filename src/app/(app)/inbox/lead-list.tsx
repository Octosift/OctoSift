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

export function ScoreBadge({ score, kind }: { score: number; kind: string }) {
  if (kind === 'brand_mention') {
    return (
      <Badge tone="outline" className="mt-px w-8 self-start justify-center">
        @
      </Badge>
    );
  }
  return (
    <Badge
      tone={scoreTone(score)}
      className="mt-px w-8 self-start justify-center tabular"
      aria-label={`Score ${score}`}
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
                'flex gap-2.5 border-b border-l-2 border-border border-l-transparent px-3 py-2 hover:bg-muted/60',
                selected && 'border-l-brand bg-selection hover:bg-selection',
              )}
            >
              <ScoreBadge score={row.score} kind={row.kind} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate font-medium">{row.title}</span>
                  {row.status === 'drafted' ? (
                    <Badge tone="brand" className="shrink-0">
                      Draft ready
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">r/{row.subreddit}</span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0 tabular">{formatAge(now - row.postCreatedAt)}</span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">
                    {row.kind === 'brand_mention' ? 'Brand mention' : intentLabel(row.intent)}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.reason}</p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
