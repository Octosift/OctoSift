'use client';

import { ArrowLeft, Copy, ExternalLink, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useImperativeHandle, useRef, useState, useTransition, type RefObject } from 'react';
import type { LeadDetail } from '@/core/db/queries/inbox';
import type { PacingWarning } from '@/core/guard/pacing';
import { Button } from '../../components/ui/button';
import { Badge, Banner, Disclosure, Kbd } from '../../components/ui/display';
import { Select } from '../../components/ui/fields';
import {
  dismissLead,
  markReplied,
  restoreLead,
  snoozeLead,
  type ActionResult,
} from '../../lib/actions/leads';
import { formatAgo, formatClock, plural } from '../../lib/format';
import { intentLabel, RISK_LABELS } from '../../lib/text';
import { DraftEditor, type DraftEditorHandle } from './draft-editor';
import { DismissDialog, ReplyConfirmDialog } from './lead-dialogs';
import { LeadFeedback } from './lead-feedback';
import { PostCard, StatusNote } from './lead-parts';
import { ScoreBadge } from './lead-list';

const NO_DRAFT_HINT = 'Write a draft first.';

export interface PanelHandlers {
  copyAndOpen: () => void;
  editDraft: () => void;
  regenerate: () => void;
  snooze: () => void;
  dismiss: () => void;
}

type Message = { tone: 'info' | 'danger'; text: string } | null;

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
  const [pending, startTransition] = useTransition();
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const editorHandle = useRef<DraftEditorHandle | null>(null);
  const isBrand = lead.kind === 'brand_mention';
  const open = lead.status !== 'replied' && lead.status !== 'dismissed';
  // Brand mentions only open the thread; opportunities need a reply to copy.
  const canCopy = isBrand || text.trim().length > 0;

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
    if (!canCopy) {
      // Reached from the keyboard shortcut; the button itself is disabled.
      setMessage({ tone: 'info', text: NO_DRAFT_HINT });
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

  const [firstWarning, ...otherWarnings] = pacing?.warnings ?? [];

  return (
    <article aria-labelledby="lead-title" className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-border px-6 py-4">
        <Link
          href={backHref}
          className="flex items-center gap-1 text-xs text-muted-foreground lg:hidden"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> All leads
        </Link>
        <div className="flex items-start gap-3">
          <ScoreBadge score={lead.score} kind={lead.kind} />
          <div className="min-w-0 flex-1">
            <h2 id="lead-title" className="text-base leading-6 font-semibold tracking-tight">
              {post.title}
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span>r/{post.subreddit}</span>
              <span aria-hidden>·</span>
              <span>u/{post.author}</span>
              <span aria-hidden>·</span>
              <span>{formatAgo(post.createdAt, now)}</span>
              {post.score !== null && post.commentCount !== null ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular">
                    {plural(post.score, 'point')}, {plural(post.commentCount, 'comment')}
                  </span>
                </>
              ) : null}
              <span aria-hidden>·</span>
              <span>{productName}</span>
            </p>
          </div>
          <Button asChild size="sm">
            <a href={post.url} target="_blank" rel="noopener noreferrer">
              Reddit <ExternalLink aria-hidden />
            </a>
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 pl-11">
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
      </header>

      <div className="flex flex-1 flex-col gap-3 px-6 py-4 md:min-h-0 md:overflow-y-auto">
        <StatusNote detail={detail} now={now} />

        {pacing && open && firstWarning ? (
          <Disclosure
            tone="warning"
            summary={
              <span className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {firstWarning.message}
              </span>
            }
            meta={otherWarnings.length > 0 ? `+${String(otherWarnings.length)} more` : 'Why'}
          >
            <div className="flex flex-col gap-1.5 pl-6.5 text-[13px]">
              {otherWarnings.length > 0 ? (
                <ul className="list-disc pl-4">
                  {otherWarnings.map((warning) => (
                    <li key={warning.rule}>{warning.message}</li>
                  ))}
                </ul>
              ) : null}
              <p>{pacing.reason}</p>
            </div>
          </Disclosure>
        ) : null}

        <PostCard text={post.bodyText} quote={lead.evidenceQuote} reason={lead.reason} />

        {isBrand ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
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

        {detail.dm ? (
          <Disclosure
            summary={<span className="font-medium">Private message draft</span>}
            meta="Only if the author invited messages"
          >
            <p className="text-sm leading-6 whitespace-pre-wrap">{detail.dm.text}</p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => {
                void navigator.clipboard.writeText(detail.dm?.text ?? '').then(() => {
                  setMessage({ tone: 'info', text: 'Private message copied.' });
                });
              }}
            >
              <Copy aria-hidden /> Copy private message
            </Button>
          </Disclosure>
        ) : null}

        <LeadFeedback leadId={lead.id} feedback={detail.feedback} onError={setMessage} />

        {lead.snoozedUntil && lead.status === 'snoozed' ? (
          <p className="text-xs text-muted-foreground">
            Comes back at {formatClock(lead.snoozedUntil)}.
          </p>
        ) : null}
      </div>

      <footer className="@container sticky bottom-0 flex shrink-0 flex-col gap-2 border-t border-border bg-background/95 px-6 py-3 backdrop-blur">
        {message ? (
          <Banner
            tone={message.tone === 'danger' ? 'danger' : 'info'}
            role={message.tone === 'danger' ? 'alert' : 'status'}
            className="py-2"
          >
            {message.text}
          </Banner>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="brand"
            onClick={copyAndOpen}
            disabled={pending || !canCopy}
            aria-describedby={canCopy ? undefined : 'copy-hint'}
          >
            <Copy aria-hidden />
            {isBrand ? 'Open thread' : 'Copy and open thread'}
            <Kbd className="ml-1 hidden border-transparent bg-black/10 text-current @2xl:inline-flex dark:bg-black/20">
              c
            </Kbd>
          </Button>
          {canCopy ? null : (
            <span id="copy-hint" className="text-xs text-muted-foreground">
              {NO_DRAFT_HINT}
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {open ? (
              <>
                <Select
                  aria-label="Snooze for"
                  className="h-9 w-auto"
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
                  Snooze <Kbd className="hidden @2xl:inline-flex">s</Kbd>
                </Button>
                <Button
                  onClick={() => {
                    setDismissOpen(true);
                  }}
                  disabled={pending}
                >
                  Dismiss <Kbd className="hidden @2xl:inline-flex">x</Kbd>
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
        </div>
      </footer>

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
    </article>
  );
}
