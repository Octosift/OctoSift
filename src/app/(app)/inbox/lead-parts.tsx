'use client';

import type { LeadDetail } from '@/core/db/queries/inbox';
import { Badge, Banner } from '../../components/ui/display';
import { formatAge, formatAgo } from '../../lib/format';
import { highlightQuote } from '../../lib/text';

export function PostBody({ text, quote }: { text: string; quote: string }) {
  if (text.trim().length === 0) {
    return <p className="text-sm text-muted-foreground italic">This post has no text.</p>;
  }
  return (
    <p className="text-sm leading-6 whitespace-pre-wrap">
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
