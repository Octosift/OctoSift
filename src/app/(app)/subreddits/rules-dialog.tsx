'use client';

import { ScrollText } from 'lucide-react';
import { useState, useTransition } from 'react';
import type { RulesSummary } from '@/core/ai/schemas';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Badge } from '../../components/ui/display';
import { Textarea } from '../../components/ui/fields';
import { saveSubredditRules } from '../../lib/actions/subreddits';
import { formatAgo } from '../../lib/format';

const PROMOTION: Record<
  RulesSummary['promotion'],
  { label: string; tone: 'brand' | 'warning' | 'danger' | 'outline' }
> = {
  allowed: { label: 'Promotion allowed', tone: 'brand' },
  restricted: { label: 'Promotion restricted', tone: 'warning' },
  forbidden: { label: 'No promotion', tone: 'danger' },
  unclear: { label: 'Promotion unclear', tone: 'outline' },
};

const LINKS: Record<RulesSummary['links'], string> = {
  allowed: 'Links allowed',
  forbidden: 'No links',
  unclear: 'Links unclear',
};

/** Days after which a rules summary is flagged as possibly out of date. */
const STALE_AFTER_S = 30 * 24 * 3600;

export function RulesSummaryLine({
  summary,
  updatedAt,
  now,
}: {
  summary: RulesSummary;
  updatedAt: number | null;
  now: number;
}) {
  const stale = updatedAt !== null && now - updatedAt > STALE_AFTER_S;
  return (
    <div className="mt-1 flex max-w-sm flex-wrap items-center gap-1">
      <Badge tone={PROMOTION[summary.promotion].tone}>{PROMOTION[summary.promotion].label}</Badge>
      <Badge tone="outline">{LINKS[summary.links]}</Badge>
      {updatedAt !== null ? (
        <span
          className={stale ? 'text-xs text-warning-foreground' : 'text-xs text-muted-foreground'}
        >
          {stale
            ? `Summarised ${formatAgo(updatedAt, now)}; rules may have changed`
            : `Summarised ${formatAgo(updatedAt, now)}`}
        </span>
      ) : null}
    </div>
  );
}

export function RulesDialog({
  name,
  text,
  summary,
}: {
  name: string;
  text: string | null;
  summary: RulesSummary | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(text ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="-ml-2 mt-0.5 h-6 text-xs text-muted-foreground"
        onClick={() => {
          setValue(text ?? '');
          setError(null);
          setOpen(true);
        }}
      >
        <ScrollText aria-hidden />
        {summary ? 'Update rules' : 'Paste rules'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Rules of r/${name}`}
        description="Copy the rules from the subreddit's sidebar or rules page and paste them here. They are summarised once and applied to every lead from this subreddit."
        className="max-w-lg"
      >
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await saveSubredditRules({ name, text: value });
              if (result.ok) {
                setOpen(false);
              } else {
                setError(result.error);
              }
            });
          }}
        >
          <label htmlFor={`rules-${name}`} className="sr-only">
            Rules of r/{name}
          </label>
          <Textarea
            id={`rules-${name}`}
            rows={10}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            placeholder={'1. Be helpful\n2. No self-promotion outside the weekly thread\n…'}
            aria-invalid={error ? true : undefined}
          />
          {summary && summary.notes.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Current summary</p>
              <ul className="mt-1 list-disc pl-4">
                {summary.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-danger-foreground">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || value.trim() === ''}>
              {pending ? 'Summarising…' : 'Summarise and save'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
