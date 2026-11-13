'use client';

import { ArrowLeft, Copy, ExternalLink, ThumbsDown, ThumbsUp } from 'lucide-react';
import Link from 'next/link';
import { useImperativeHandle, useRef, useState, useTransition, type RefObject } from 'react';
import type { LeadDetail } from '@/core/db/queries/inbox';
import type { PacingWarning } from '@/core/guard/pacing';
import { Button } from '../../components/ui/button';
import { Badge, Banner, Kbd } from '../../components/ui/display';
import { Dialog } from '../../components/ui/dialog';
import { Checkbox, Field, Input, Select } from '../../components/ui/fields';
import {
  dismissLead,
  giveFeedback,
  markReplied,
  restoreLead,
  snoozeLead,
  type ActionResult,
} from '../../lib/actions/leads';
import { formatAgo, formatClock } from '../../lib/format';
import { highlightQuote, intentLabel, RISK_LABELS } from '../../lib/text';
import { DraftEditor, type DraftEditorHandle } from './draft-editor';
import { ScoreBadge } from './lead-list';

export interface PanelHandlers {
  copyAndOpen: () => void;
  editDraft: () => void;
  regenerate: () => void;
  snooze: () => void;
  dismiss: () => void;
}

type Message = { tone: 'info' | 'danger'; text: string } | null;

function PostBody({ text, quote }: { text: string; quote: string }) {
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

function StatusNote({ detail, now }: { detail: LeadDetail; now: number }) {
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

export function LeadPanel({
  detail,
  pacing,
  now,
  register,
  onMoved,
  backHref,
}: {
  detail: LeadDetail;
  pacing: { warnings: PacingWarning[]; reason: string } | null;
  now: number;
  register: RefObject<PanelHandlers | null>;
  onMoved: () => void;
  backHref: string;
}) {
  const { lead, post, productName } = detail;
  const [text, setText] = useState(detail.reply?.text ?? '');
  const [message, setMessage] = useState<Message>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [snoozeDays, setSnoozeDays] = useState('1');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [pending, startTransition] = useTransition();
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const editorHandle = useRef<DraftEditorHandle | null>(null);
  const isBrand = lead.kind === 'brand_mention';
  const open = lead.status !== 'replied' && lead.status !== 'dismissed';

  function run(action: () => Promise<ActionResult>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setMessage(null);
        after?.();
      } else {
        setMessage({ tone: 'danger', text: result.error });
      }
    });
  }

  function copyAndOpen() {
    if (!isBrand && text.trim().length === 0) {
      setMessage({ tone: 'danger', text: 'There is no draft to copy yet. Write one first.' });
      return;
    }
    // Both start inside the click, so the browser treats them as user actions.
    if (!isBrand) {
      void navigator.clipboard.writeText(text).catch(() => {
        setMessage({
          tone: 'danger',
          text: 'Could not copy automatically. Select the draft and copy it.',
        });
      });
    }
    window.open(post.url, '_blank', 'noopener,noreferrer');
    if (open) setConfirmOpen(true);
  }

  function snooze() {
    run(() => snoozeLead({ leadId: lead.id, days: Number(snoozeDays) }), onMoved);
  }

  useImperativeHandle(register, () => ({
    copyAndOpen,
    editDraft: () => editorRef.current?.focus(),
    regenerate: () => editorHandle.current?.regenerate(),
    snooze,
    dismiss: () => {
      setDismissOpen(true);
    },
  }));

  return (
    <article aria-labelledby="lead-title" className="flex flex-col gap-4 px-6 py-5">
      <Link
        href={backHref}
        className="flex items-center gap-1 text-xs text-muted-foreground lg:hidden"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> All leads
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <ScoreBadge score={lead.score} kind={lead.kind} />
          <h2 id="lead-title" className="min-w-0 flex-1 text-[15px] leading-6 font-semibold">
            {post.title}
          </h2>
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Reddit <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>r/{post.subreddit}</span>
          <span aria-hidden>·</span>
          <span>u/{post.author}</span>
          <span aria-hidden>·</span>
          <span>{formatAgo(post.createdAt, now)}</span>
          <span aria-hidden>·</span>
          <span>{productName}</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {isBrand ? (
            <Badge tone="outline">Brand mention</Badge>
          ) : (
            <>
              <Badge tone="outline">{lead.fit === 'direct' ? 'Direct fit' : 'Soft fit'}</Badge>
              <Badge tone="outline">{intentLabel(lead.intent)}</Badge>
              {lead.modelScore !== lead.score ? (
                <Badge tone="outline" className="tabular">
                  Model {lead.modelScore}, adjusted {lead.score}
                </Badge>
              ) : null}
            </>
          )}
          {lead.riskFlagsJson.map((flag) => (
            <Badge key={flag} tone="warning">
              {RISK_LABELS[flag] ?? flag}
            </Badge>
          ))}
        </div>
        <p className="text-[13px]">{lead.reason}</p>
      </header>

      <StatusNote detail={detail} now={now} />

      <section aria-label="Post" className="rounded-lg border border-border bg-surface px-4 py-3">
        <PostBody text={post.bodyText} quote={lead.evidenceQuote} />
      </section>

      {pacing && open ? (
        <Banner tone="warning">
          <div>
            <ul className="list-disc pl-4">
              {pacing.warnings.map((warning) => (
                <li key={warning.rule}>{warning.message}</li>
              ))}
            </ul>
            <p className="mt-1">{pacing.reason}</p>
          </div>
        </Banner>
      ) : null}

      {isBrand ? (
        <p className="text-[13px] text-muted-foreground">
          This post mentions {productName}. No pitch is drafted for brand mentions; if a reply
          helps, write it in your own words and say who you are.
        </p>
      ) : (
        <DraftEditor
          detail={detail}
          text={text}
          onTextChange={setText}
          editorRef={editorRef}
          handleRef={editorHandle}
          onMessage={setMessage}
        />
      )}

      {message ? (
        <Banner
          tone={message.tone === 'danger' ? 'danger' : 'info'}
          role={message.tone === 'danger' ? 'alert' : 'status'}
        >
          {message.text}
        </Banner>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="brand" onClick={copyAndOpen} disabled={pending}>
          <Copy aria-hidden />
          {isBrand ? 'Open thread' : 'Copy and open thread'}
          <Kbd className="ml-1 border-transparent bg-black/10 text-current dark:bg-black/20">c</Kbd>
        </Button>
        {detail.dm ? (
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(detail.dm?.text ?? '').then(() => {
                setMessage({ tone: 'info', text: 'Private message copied.' });
              });
            }}
          >
            Copy private message
          </Button>
        ) : null}
      </div>

      {detail.dm ? (
        <details className="rounded-md border border-border px-3 py-2 text-[13px]">
          <summary className="cursor-pointer text-xs font-medium">Private message draft</summary>
          <p className="mt-2 whitespace-pre-wrap">{detail.dm.text}</p>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {open ? (
          <>
            <Select
              aria-label="Snooze for"
              className="h-8 w-auto"
              value={snoozeDays}
              onChange={(event) => {
                setSnoozeDays(event.target.value);
              }}
            >
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">1 week</option>
            </Select>
            <Button onClick={snooze} disabled={pending}>
              Snooze <Kbd>s</Kbd>
            </Button>
            <Button
              onClick={() => {
                setDismissOpen(true);
              }}
              disabled={pending}
            >
              Dismiss <Kbd>x</Kbd>
            </Button>
          </>
        ) : null}
        {lead.status === 'snoozed' || lead.status === 'dismissed' ? (
          <Button
            onClick={() => {
              run(() => restoreLead({ leadId: lead.id }));
            }}
            disabled={pending}
          >
            Move back to New
          </Button>
        ) : null}
      </div>

      <section aria-labelledby="feedback-heading" className="flex flex-col gap-2">
        <h3 id="feedback-heading" className="text-xs font-medium text-muted-foreground">
          Was this a good lead?{' '}
          {detail.feedback
            ? `You said ${detail.feedback.signal}${detail.feedback.note ? `: ${detail.feedback.note}` : ''}.`
            : null}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Note for future scans"
            className="h-8 max-w-sm flex-1"
            placeholder="Optional note, e.g. we don't serve students"
            value={feedbackNote}
            onChange={(event) => {
              setFeedbackNote(event.target.value);
            }}
          />
          <Button
            onClick={() => {
              run(
                () => giveFeedback({ leadId: lead.id, signal: 'good', note: feedbackNote }),
                () => {
                  setFeedbackNote('');
                },
              );
            }}
            disabled={pending}
          >
            <ThumbsUp aria-hidden /> Good
          </Button>
          <Button
            onClick={() => {
              run(
                () => giveFeedback({ leadId: lead.id, signal: 'bad', note: feedbackNote }),
                () => {
                  setFeedbackNote('');
                },
              );
            }}
            disabled={pending}
          >
            <ThumbsDown aria-hidden /> Bad
          </Button>
        </div>
      </section>

      <ReplyConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        mentionsProduct={detail.reply?.mentionsProduct ?? false}
        productName={productName}
        onConfirm={(commentUrl, mentioned) => {
          run(
            () => markReplied({ leadId: lead.id, commentUrl, mentioned }),
            () => {
              setConfirmOpen(false);
              onMoved();
            },
          );
        }}
        pending={pending}
      />
      <DismissDialog
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        onConfirm={(reason) => {
          run(
            () => dismissLead({ leadId: lead.id, reason }),
            () => {
              setDismissOpen(false);
              onMoved();
            },
          );
        }}
        pending={pending}
      />
      {lead.snoozedUntil && lead.status === 'snoozed' ? (
        <p className="text-xs text-muted-foreground">
          Comes back at {formatClock(lead.snoozedUntil)}.
        </p>
      ) : null}
    </article>
  );
}

function ReplyConfirmDialog({
  open,
  onOpenChange,
  mentionsProduct,
  productName,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mentionsProduct: boolean;
  productName: string;
  onConfirm: (commentUrl: string, mentioned: boolean) => void;
  pending: boolean;
}) {
  const [commentUrl, setCommentUrl] = useState('');
  const [mentioned, setMentioned] = useState(mentionsProduct);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Did you post your reply?"
      description="The draft is on your clipboard and the thread is open in a new tab."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(commentUrl, mentioned);
        }}
      >
        <Field
          label="Link to your comment (optional)"
          htmlFor="comment-url"
          hint="Used later to check that your comment is visible."
        >
          <Input
            id="comment-url"
            type="url"
            placeholder="https://www.reddit.com/r/…/comments/…"
            value={commentUrl}
            onChange={(event) => {
              setCommentUrl(event.target.value);
            }}
          />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox
            checked={mentioned}
            onChange={(event) => {
              setMentioned(event.target.checked);
            }}
          />
          My reply mentions {productName}
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Not yet
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            Mark as replied
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const DISMISS_REASONS = ['Not a fit', 'Already answered', 'Not worth replying to'];

function DismissDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Dismiss this lead"
      description="A short reason helps you review dismissed leads later."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(reason);
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          {DISMISS_REASONS.map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setReason(preset);
              }}
            >
              {preset}
            </Button>
          ))}
        </div>
        <Field label="Reason (optional)" htmlFor="dismiss-reason">
          <Input
            id="dismiss-reason"
            autoFocus
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            Dismiss
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
