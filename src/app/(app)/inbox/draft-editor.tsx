'use client';

import { RotateCw } from 'lucide-react';
import { useImperativeHandle, useState, useTransition, type RefObject } from 'react';
import type { LeadDetail } from '@/core/db/queries/inbox';
import { Button } from '../../components/ui/button';
import { Badge, Kbd } from '../../components/ui/display';
import { Input, Select } from '../../components/ui/fields';
import { regenerateDraft, saveDraftText } from '../../lib/actions/leads';
import { MODE_LABELS, wordCount } from '../../lib/text';

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
      onMessage({ tone: 'info', text: 'Writing a new draft…' });
      const result = await regenerateDraft({
        leadId: detail.lead.id,
        mode,
        ...(instruction.trim() ? { instruction } : {}),
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
  const problems = [
    ...(draft?.checkFailuresJson ?? []),
    ...(draft?.reviewDecision === 'REVISE' ? draft.reviewReasonsJson : []),
  ];

  return (
    <section aria-labelledby="draft-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="draft-heading" className="text-[13px] font-semibold">
          Reply draft
        </h3>
        {review ? <Badge tone={review.tone}>{review.label}</Badge> : null}
        {draft ? <Badge tone="outline">{MODE_LABELS[draft.mode]}</Badge> : null}
        {draft?.editedByUser ? <Badge tone="outline">Edited</Badge> : null}
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
            rows={9}
            className="w-full rounded-md border border-input bg-surface px-3 py-2 text-[13px] leading-5"
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular">{wordCount(text)} words</span>
            {dirty ? (
              <Button size="sm" variant="outline" onClick={save} disabled={pending}>
                Save edits
              </Button>
            ) : null}
          </div>
          {problems.length > 0 ? (
            <ul className="list-disc rounded-md border border-warning-border bg-warning px-3 py-2 pl-7 text-xs text-warning-foreground">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          {draft.notesForUser ? (
            <p className="text-xs text-muted-foreground">Note: {draft.notesForUser}</p>
          ) : null}
        </>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-[13px] text-muted-foreground">
          {detail.lead.draftError ??
            'No draft yet. Leads below the draft threshold are drafted on request.'}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="draft-mode" className="text-xs text-muted-foreground">
            Mode
          </label>
          <Select
            id="draft-mode"
            className="h-7 w-auto text-xs"
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
        </div>
        <div className="flex min-w-40 flex-1 flex-col gap-1">
          <label htmlFor="draft-instruction" className="text-xs text-muted-foreground">
            Instruction (optional)
          </label>
          <Input
            id="draft-instruction"
            className="h-7 text-xs"
            placeholder="e.g. shorter, mention the free plan"
            value={instruction}
            onChange={(event) => {
              setInstruction(event.target.value);
            }}
          />
        </div>
        <Button size="sm" onClick={regenerate} disabled={pending}>
          <RotateCw className={pending ? 'animate-spin' : undefined} aria-hidden />
          {draft ? 'Regenerate' : 'Write a draft'}
          <Kbd className="ml-1">r</Kbd>
        </Button>
      </div>
      {!detail.lead.mentionOk ? (
        <p className="text-xs text-muted-foreground">
          Only helpful replies are offered here: the author is venting, asked for no tools, or the
          subreddit does not allow promotion.
        </p>
      ) : null}
    </section>
  );
}
