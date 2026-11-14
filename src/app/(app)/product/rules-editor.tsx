'use client';

import { useState, useTransition } from 'react';
import type { FeedbackRule } from '@/core/db/queries/feedback';
import { Button } from '../../components/ui/button';
import { Badge, Card, CardHeader } from '../../components/ui/display';
import { Input } from '../../components/ui/fields';
import { saveRule } from '../../lib/actions/product';

function RuleRow({ rule }: { rule: FeedbackRule }) {
  const [note, setNote] = useState(rule.note);
  const [pending, startTransition] = useTransition();
  const dirty = note.trim() !== rule.note;
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex gap-2">
        <Input
          aria-label="Rule"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <Button
          disabled={pending || !dirty || note.trim() === ''}
          onClick={() => {
            startTransition(async () => {
              await saveRule({ id: rule.id, note });
            });
          }}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await saveRule({ id: rule.id, note: '' });
            });
          }}
        >
          Remove
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Badge tone={rule.signal === 'good' ? 'brand' : 'outline'}>
          {rule.signal === 'good' ? 'Good lead' : 'Bad lead'}
        </Badge>
        {rule.leadTitle ? <span className="truncate">from “{rule.leadTitle}”</span> : null}
      </p>
    </li>
  );
}

/** Notes left on leads become rules that the qualify stage follows. */
export function RulesEditor({ rules }: { rules: FeedbackRule[] }) {
  return (
    <Card id="feedback">
      <CardHeader
        title="What you told us about past leads"
        description="The latest notes, without repeats, are added to every qualify call together with your five latest good and bad leads."
      />
      {rules.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          No rules yet. Mark leads as good or bad with a short note in the inbox, for example
          &ldquo;we don&apos;t serve students&rdquo;, and it appears here.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rules.map((rule) => (
            <RuleRow key={`${rule.id}:${rule.note}`} rule={rule} />
          ))}
        </ul>
      )}
    </Card>
  );
}
