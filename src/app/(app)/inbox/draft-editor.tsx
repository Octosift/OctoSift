'use client';

import { RotateCw } from 'lucide-react';
import { useImperativeHandle, useState, useTransition, type RefObject } from 'react';
import type { LeadDetail } from '@/core/db/queries/inbox';
import { Button } from '../../components/ui/button';
import { Badge, Kbd } from '../../components/ui/display';
import { Input, Select } from '../../components/ui/fields';
import { cn } from '../../components/ui/utils';
import { regenerateDraft, saveDraftText } from '../../lib/actions/leads';
import { MODE_LABELS, wordCount } from '../../lib/text';
import { DraftSteps } from './draft-steps';

type Mode = keyof typeof MODE_LABELS;

const REVIEW_BADGES = {
  APPROVE: { tone: 'brand', label: 'Reviewed: approved' },
  REVISE: { tone: 'warning', label: 'Reviewer asked for changes' },
  NOT_REVIEWED: { tone: 'neutral', label: 'Not reviewed' },
  REJECT: { tone: 'danger', label: 'Rejected by reviewer' },
} as const;

export interface DraftEditorHandle {
  text: string;
  regenerate: () => void;
}

export function DraftEditor({
  detail,
  text,
  onTextChange,
  editorRef,
  handleRef,
  onMessage,
}: {
  detail: LeadDetail;
  text: string;
  onTextChange: (text: string) => void;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  handleRef: RefObject<DraftEditorHandle | null>;
  onMessage: (message: { tone: 'info' | 'danger'; text: string } | null) => void;
}) {
  const draft = detail.reply;
  const [mode, setMode] = useState<Mode>(
    draft?.mode ?? (detail.lead.mentionOk ? 'soft_mention' : 'helpful_only'),
  );
  const [instruction, setInstruction] = useState('');
  const [pending, startTransition] = useTransition();
  const dirty = draft !== null && text !== draft.text;

  function regenerate() {
    startTransition(async () => {
      onMessage(null);
      // A new reply leaves the private message alone; it has its own rewrite button.
      const result = await regenerateDraft({
        leadId: detail.lead.id,
        mode,
        ...(instruction.trim() ? { instruction } : {}),
        ...(draft ? { only: 'reply' as const } : {}),
      });
      onMessage(result.ok ? null : { tone: 'danger', text: result.error });
      if (result.ok) setInstruction('');
    });
  }

  function save() {
    if (!draft) return;
    startTransition(async () => {
      const result = await saveDraftText({ draftId: draft.id, text });
      onMessage(
        result.ok ? { tone: 'info', text: 'Draft saved.' } : { tone: 'danger', text: result.error },
      );
    });
  }

  useImperativeHandle(handleRef, () => ({ text, regenerate }));
  const review = draft?.reviewDecision ? REVIEW_BADGES[draft.reviewDecision] : null;
  const checks = draft?.checkFailuresJson ?? [];
  const reviewerNotes = draft?.reviewDecision === 'REVISE' ? draft.reviewReasonsJson : [];

  return (
    <section
      aria-labelledby="draft-heading"
      className="rounded-xl border border-border bg-surface shadow-card transition-colors has-[textarea:focus]:border-ring/60"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h3 id="draft-heading" className="text-sm font-semibold">
          Reply draft
        </h3>
        {review ? <Badge tone={review.tone}>{review.label}</Badge> : null}
        {draft ? <Badge tone="outline">{MODE_LABELS[draft.mode]}</Badge> : null}
        {draft?.editedByUser ? <Badge tone="outline">Edited</Badge> : null}
        {draft ? (
          <span className="ml-auto text-xs text-muted-foreground tabular">
            {wordCount(text)} words
          </span>
        ) : null}
      </div>

      {draft ? (
        <>
          <label htmlFor="draft-text" className="sr-only">
            Reply draft
          </label>
          <textarea
            id="draft-text"
            ref={editorRef}
            value={text}
            onChange={(event) => {
              onTextChange(event.target.value);
            }}
            rows={8}
            readOnly={pending}
            className={cn(
              'block w-full resize-y bg-transparent px-4 py-3 text-sm leading-6 transition-opacity focus:outline-none focus-visible:outline-none',
              pending && 'opacity-50',
            )}
          />
          {pending ? (
            <div className="px-4 pb-3">
              <DraftSteps leadId={detail.lead.id} />
            </div>
          ) : checks.length > 0 || reviewerNotes.length > 0 || draft.notesForUser ? (
            <div className="flex flex-col gap-2 px-4 pb-3">
              {reviewerNotes.length > 0 ? (
                <Notes
                  title="The reviewer would change this before posting"
                  items={reviewerNotes}
                />
              ) : null}
              {checks.length > 0 ? (
                <Notes title="The automatic checks still found" items={checks} />
              ) : null}
              {draft.notesForUser ? (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Before you post: </span>
                  {draft.notesForUser}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : pending ? (
        <div className="px-4 py-3">
          <DraftSteps leadId={detail.lead.id} />
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {detail.lead.draftError ??
            'No draft yet. Only the strongest leads get one during a scan; write one here when you want it.'}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-border bg-surface-raised/60 px-4 py-2.5">
        <Select
          id="draft-mode"
          aria-label="Reply mode"
          className="h-8 w-auto text-[13px]"
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as Mode);
          }}
        >
          {Object.entries(MODE_LABELS).map(([value, label]) => (
            <option
              key={value}
              value={value}
              disabled={value !== 'helpful_only' && !detail.lead.mentionOk}
            >
              {label}
            </option>
          ))}
        </Select>
        <Input
          id="draft-instruction"
          aria-label="Instruction for the next draft"
          className="h-8 min-w-40 flex-1 text-[13px]"
          placeholder="Instruction for a new draft, e.g. shorter"
          value={instruction}
          onChange={(event) => {
            setInstruction(event.target.value);
          }}
        />
        <Button size="sm" onClick={regenerate} disabled={pending}>
          <RotateCw className={pending ? 'animate-spin' : undefined} aria-hidden />
          {draft ? 'Regenerate' : 'Write a draft'}
          <Kbd className="ml-0.5">r</Kbd>
        </Button>
        {dirty ? (
          <Button size="sm" variant="primary" onClick={save} disabled={pending}>
            Save edits
          </Button>
        ) : null}
      </div>
      {!detail.lead.mentionOk ? (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Only helpful replies are offered here: the author is venting, asked for no tools, or the
          subreddit does not allow promotion.
        </p>
      ) : null}
    </section>
  );
}

function Notes({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-warning-border bg-warning px-3 py-2 text-xs text-warning-foreground">
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc pl-4">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
