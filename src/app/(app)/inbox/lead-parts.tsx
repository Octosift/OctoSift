'use client';

import type { LeadDetail } from '@/core/db/queries/inbox';
import { Banner } from '../../components/ui/display';
import { formatAgo } from '../../lib/format';
import { highlightQuote } from '../../lib/text';

export function PostBody({ text, quote }: { text: string; quote: string }) {
  if (text.trim().length === 0) {
    return <p className="text-[13px] text-muted-foreground italic">This post has no text.</p>;
  }
  return (
    <p className="text-[13px] leading-6 whitespace-pre-wrap">
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
