'use client';

import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/fields';
import { giveFeedback } from '../../lib/actions/leads';

/** Good or bad, with an optional note that later scans learn from. */
export function LeadFeedback({
  leadId,
  feedback,
  onError,
}: {
  leadId: string;
  feedback: { signal: string; note: string } | null;
  onError: (message: { tone: 'danger'; text: string }) => void;
}) {
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const give = (signal: 'good' | 'bad') => {
    startTransition(async () => {
      const result = await giveFeedback({ leadId, signal, note });
      if (result.ok) setNote('');
      else onError({ tone: 'danger', text: result.error });
    });
  };
  return (
    <section
      aria-labelledby="feedback-heading"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2.5"
    >
      <h3 id="feedback-heading" className="text-[13px] text-muted-foreground">
        Was this a good lead?
        {feedback
          ? ` You said ${feedback.signal}${feedback.note ? `: ${feedback.note}` : ''}.`
          : null}
      </h3>
      <Input
        aria-label="Note for future scans"
        className="h-8 min-w-40 flex-1 text-[13px]"
        placeholder="Optional note, e.g. we don't serve students"
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      <Button
        size="sm"
        onClick={() => {
          give('good');
        }}
        disabled={pending}
      >
        <ThumbsUp aria-hidden /> Good
      </Button>
      <Button
        size="sm"
        onClick={() => {
          give('bad');
        }}
        disabled={pending}
      >
        <ThumbsDown aria-hidden /> Bad
      </Button>
    </section>
  );
}
