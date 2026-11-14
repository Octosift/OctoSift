'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { EmptyState, Kbd } from '../../components/ui/display';
import { Dialog } from '../../components/ui/dialog';
import { cn } from '../../components/ui/utils';
import type { InboxData } from '../../lib/data/inbox';
import { InboxFilters } from './inbox-filters';
import { InboxTabs } from './inbox-tabs';
import { LeadList } from './lead-list';
import { LeadPanel, type PanelHandlers } from './lead-panel';
import { inboxHref } from './url';

const EMPTY: Record<string, { title: string; body: string }> = {
  todo: {
    title: 'Nothing to do yet',
    body: 'Leads appear here, best first, after a scan finds posts from people your product can help. Strong leads come with a reviewed reply draft. Scans run every hour, or press Scan now.',
  },
  replied: {
    title: 'No replies yet',
    body: 'When you post a reply and mark it as replied, the lead moves here.',
  },
  snoozed: {
    title: 'Nothing snoozed',
    body: 'Snoozed leads come back to To do when their time is up.',
  },
  dismissed: {
    title: 'Nothing dismissed',
    body: 'Leads you dismiss are kept here with your reason.',
  },
  brand: {
    title: 'No brand mentions',
    body: 'Posts that mention your product by name or domain appear here, without a drafted pitch.',
  },
};

const SHORTCUTS: [string, string][] = [
  ['j', 'Next lead'],
  ['k', 'Previous lead'],
  ['c', 'Copy the draft and open the thread'],
  ['e', 'Edit the draft'],
  ['r', 'Regenerate the draft'],
  ['s', 'Snooze'],
  ['x', 'Dismiss'],
  ['?', 'Show these shortcuts'],
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function InboxView({ data }: { data: InboxData }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handlers = useRef<PanelHandlers | null>(null);
  const [help, setHelp] = useState(false);
  const ids = data.rows.map((row) => row.id);
  const selectedId = data.detail?.lead.id ?? null;
  const explicitSelection = data.params.lead !== undefined;
  const filtered = Boolean(
    data.params.product ??
    data.params.subreddit ??
    data.params.intent ??
    data.params.min ??
    data.params.age,
  );

  function select(offset: number) {
    const index = selectedId ? ids.indexOf(selectedId) : -1;
    const next = ids[Math.min(ids.length - 1, Math.max(0, index + offset))];
    if (next && next !== selectedId)
      router.replace(inboxHref(searchParams, { lead: next }), { scroll: false });
  }

  function afterMove() {
    const index = selectedId ? ids.indexOf(selectedId) : -1;
    const next = ids[index + 1] ?? ids[index - 1];
    router.replace(inboxHref(searchParams, { lead: next ?? null }), { scroll: false });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const actions: Record<string, () => void> = {
        j: () => {
          select(1);
        },
        k: () => {
          select(-1);
        },
        c: () => handlers.current?.copyAndOpen(),
        e: () => handlers.current?.editDraft(),
        r: () => handlers.current?.regenerate(),
        s: () => handlers.current?.snooze(),
        x: () => handlers.current?.dismiss(),
        '?': () => {
          setHelp(true);
        },
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  const first = (data.params.page - 1) * data.pageSize + 1;
  const last = first + data.rows.length - 1;
  const empty = EMPTY[data.params.tab] ?? { title: 'Nothing here', body: '' };

  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(320px,440px)_minmax(0,1fr)]">
      <section
        aria-label="Lead list"
        className={cn(
          'flex min-w-0 flex-col border-border lg:border-r',
          explicitSelection && 'hidden lg:flex',
        )}
      >
        <InboxTabs active={data.params.tab} counts={data.counts} evergreen={data.evergreen} />
        <InboxFilters
          products={data.products}
          subreddits={data.subreddits}
          values={{
            ...(data.params.product ? { product: data.params.product } : {}),
            ...(data.params.subreddit ? { subreddit: data.params.subreddit } : {}),
            ...(data.params.intent ? { intent: data.params.intent } : {}),
            ...(data.params.min !== undefined ? { min: data.params.min } : {}),
            ...(data.params.age !== undefined ? { age: data.params.age } : {}),
          }}
        />
        {data.rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No leads match these filters"
              action={
                <Button asChild size="sm">
                  <Link href={inboxHref({}, { tab: data.params.tab })}>Clear filters</Link>
                </Button>
              }
            >
              Try a different subreddit, intent or age.
            </EmptyState>
          ) : (
            <EmptyState title={empty.title}>{empty.body}</EmptyState>
          )
        ) : (
          <>
            <LeadList rows={data.rows} selectedId={selectedId} now={data.now} />
            {data.total > data.pageSize ? (
              <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                <span className="tabular">
                  {first}–{last} of {data.total}
                </span>
                <div className="flex gap-1">
                  {data.params.page > 1 ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        href={inboxHref(searchParams, { page: data.params.page - 1, lead: null })}
                      >
                        Previous
                      </Link>
                    </Button>
                  ) : null}
                  {last < data.total ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        href={inboxHref(searchParams, { page: data.params.page + 1, lead: null })}
                      >
                        Next
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
      <section
        aria-label="Lead detail"
        className={cn('min-w-0 overflow-y-auto', !explicitSelection && 'hidden lg:block')}
      >
        {data.detail ? (
          <LeadPanel
            key={`${data.detail.lead.id}:${data.detail.reply?.id ?? 'none'}`}
            detail={data.detail}
            pacing={data.pacing}
            now={data.now}
            register={handlers}
            onMoved={afterMove}
            backHref={inboxHref(searchParams, { lead: null })}
          />
        ) : (
          <EmptyState title="Select a lead">
            Choose a lead on the left, or press <Kbd>j</Kbd> to start at the top.
          </EmptyState>
        )}
      </section>
      <Dialog open={help} onOpenChange={setHelp} title="Keyboard shortcuts">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13px]">
          {SHORTCUTS.map(([key, label]) => (
            <div key={key} className="contents">
              <dt>
                <Kbd>{key}</Kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </div>
  );
}
