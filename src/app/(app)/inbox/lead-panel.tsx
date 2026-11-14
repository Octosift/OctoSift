'use client';

import { ArrowLeft, Copy, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useImperativeHandle, useRef, useState, useTransition, type RefObject } from 'react';
import type { LeadDetail } from '@/core/db/queries/inbox';
import type { PacingWarning } from '@/core/guard/pacing';
import { Button } from '../../components/ui/button';
import { Badge, Banner, Kbd } from '../../components/ui/display';
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
import { PostBody, StatusNote } from './lead-parts';
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
        <Button
          variant="brand"
          onClick={copyAndOpen}
          disabled={pending || !canCopy}
          aria-describedby={canCopy ? undefined : 'copy-hint'}
        >
          <Copy aria-hidden />
          {isBrand ? 'Open thread' : 'Copy and open thread'}
          <Kbd className="ml-1 border-transparent bg-black/10 text-current dark:bg-black/20">c</Kbd>
        </Button>
        {canCopy ? null : (
          <span id="copy-hint" className="text-xs text-muted-foreground">
            {NO_DRAFT_HINT}
          </span>
        )}
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

      <LeadFeedback leadId={lead.id} feedback={detail.feedback} onError={setMessage} />

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
