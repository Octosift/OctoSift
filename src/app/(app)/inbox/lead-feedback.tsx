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
    <section aria-labelledby="feedback-heading" className="flex flex-col gap-2">
      <h3 id="feedback-heading" className="text-xs font-medium text-muted-foreground">
        Was this a good lead?{' '}
        {feedback
          ? `You said ${feedback.signal}${feedback.note ? `: ${feedback.note}` : ''}.`
          : null}
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Note for future scans"
          className="h-8 max-w-sm flex-1"
          placeholder="Optional note, e.g. we don't serve students"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <Button
          onClick={() => {
            give('good');
          }}
          disabled={pending}
        >
          <ThumbsUp aria-hidden /> Good
        </Button>
        <Button
          onClick={() => {
            give('bad');
          }}
          disabled={pending}
        >
          <ThumbsDown aria-hidden /> Bad
        </Button>
      </div>
    </section>
  );
}
