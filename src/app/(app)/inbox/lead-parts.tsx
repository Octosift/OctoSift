'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { LeadDetail } from '@/core/db/queries/inbox';
import { Badge, Banner } from '../../components/ui/display';
import { cn } from '../../components/ui/utils';
import { formatAge, formatAgo } from '../../lib/format';
import { highlightQuote } from '../../lib/text';

export function PostBody({
  text,
  quote,
  className,
}: {
  text: string;
  quote: string;
  className?: string;
}) {
  if (text.trim().length === 0) {
    return <p className="text-sm text-muted-foreground italic">This post has no text.</p>;
  }
  return (
    <p className={cn('text-sm leading-6 whitespace-pre-wrap', className)}>
      {highlightQuote(text, quote).map((segment, index) =>
        segment.highlight ? (
          <mark
            key={index}
            className="rounded-sm bg-brand-subtle px-0.5 text-brand-subtle-foreground"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

/** The post, folded to a few lines so the reply stays in view; the reason sits on top. */
export function PostCard({ text, quote, reason }: { text: string; quote: string; reason: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 320 || text.split('\n').length > 4;
  return (
    <section
      aria-labelledby="post-heading"
      className="rounded-xl border border-border bg-surface shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h3 id="post-heading" className="text-sm font-semibold">
          Post
        </h3>
        {long ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded(!expanded);
            }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? 'Show less' : 'Show the whole post'}
            <ChevronDown
              className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
              aria-hidden
            />
          </button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">Why it is a lead: </span>
          {reason}
        </p>
        <PostBody text={text} quote={quote} className={cn(long && !expanded && 'line-clamp-4')} />
      </div>
    </section>
  );
}

const CHECK_LABELS: Readonly<Record<string, string>> = {
  '1h': 'After an hour',
  '24h': 'After a day',
};
const RESULTS = {
  visible: { label: 'visible', tone: 'brand' },
  removed: { label: 'removed', tone: 'danger' },
  post_gone: { label: 'the post is gone', tone: 'warning' },
  unknown: { label: 'could not tell', tone: 'outline' },
} as const;

/** The reply's visibility checks, read with the connected Reddit account. */
function ReplyChecks({ checks, now }: { checks: LeadDetail['replyChecks']; now: number }) {
  if (checks.length === 0) return null;
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {checks.map((check) => {
        const label = CHECK_LABELS[check.kind] ?? check.kind;
        const result = check.result ? RESULTS[check.result as keyof typeof RESULTS] : null;
        return (
          <span key={check.kind} className="flex items-center gap-1.5">
            {label}:
            {result ? (
              <Badge tone={result.tone}>{result.label}</Badge>
            ) : (
              <span className="text-muted-foreground">
                {check.dueAt > now
                  ? `checking in ${formatAge(check.dueAt - now)}`
                  : 'checking soon'}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

export function StatusNote({ detail, now }: { detail: LeadDetail; now: number }) {
  const { lead } = detail;
  if (lead.status === 'replied' && lead.repliedAt !== null) {
    return (
      <Banner>
        Replied {formatAgo(lead.repliedAt, now)}
        {lead.repliedWithMention ? ', mentioning the product' : ', without mentioning the product'}.
        {lead.commentUrl ? (
          <a
            className="ml-1 underline underline-offset-2"
            href={lead.commentUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Your comment
          </a>
        ) : null}
        <ReplyChecks checks={detail.replyChecks} now={now} />
      </Banner>
    );
  }
  if (lead.status === 'snoozed' && lead.snoozedUntil !== null) {
    return <Banner>Snoozed until {new Date(lead.snoozedUntil * 1000).toLocaleString()}.</Banner>;
  }
  if (lead.status === 'dismissed') {
    return <Banner>Dismissed{lead.dismissReason ? `: ${lead.dismissReason}` : '.'}</Banner>;
  }
  return null;
}
