'use client';

import { ArrowUpCircle, Megaphone, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { REPOSITORY_URL } from '@/core/brand';
import type { UpdateView } from '@/core/updates/check';
import { Button } from '../components/ui/button';
import { Banner } from '../components/ui/display';
import { dismissNotice } from '../lib/actions/updates';

const UPDATING_URL = `${REPOSITORY_URL}#updating`;

function Dismiss({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="-my-1 -mr-1 ml-auto size-7"
      aria-label={label}
      onClick={onDismiss}
    >
      <X aria-hidden />
    </Button>
  );
}

/**
 * A newer release, and the latest release's announcement, on Home. Both come
 * from the daily check on GitHub and can be closed. The announcement is plain
 * text with at most one link.
 */
export function UpdateNotices({ view, current }: { view: UpdateView; current: string }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  function hide(id: string, input: Parameters<typeof dismissNotice>[0]) {
    setHidden((previous) => new Set(previous).add(id));
    startTransition(async () => {
      await dismissNotice(input);
    });
  }

  const update = view.update && !hidden.has('update') ? view.update : null;
  const announcement = view.announcement && !hidden.has('announcement') ? view.announcement : null;
  if (!update && !announcement) return null;

  return (
    <div className="flex flex-col gap-2">
      {update ? (
        <Banner>
          <ArrowUpCircle className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">Octosift {update.version} is available</p>
            <p className="mt-0.5 text-muted-foreground">
              You are running {current}.{' '}
              <a
                className="text-foreground underline underline-offset-2"
                href={update.url}
                target="_blank"
                rel="noreferrer"
              >
                See what is new
              </a>{' '}
              ·{' '}
              <a
                className="text-foreground underline underline-offset-2"
                href={UPDATING_URL}
                target="_blank"
                rel="noreferrer"
              >
                How to update
              </a>
            </p>
          </div>
          <Dismiss
            label="Hide this update notice"
            onDismiss={() => {
              hide('update', { kind: 'update', version: update.version });
            }}
          />
        </Banner>
      ) : null}
      {announcement ? (
        <Banner>
          <Megaphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">From the Octosift team</p>
            <p className="mt-0.5 break-words">
              {announcement.text}
              {announcement.url ? (
                <>
                  {' '}
                  <a
                    className="underline underline-offset-2"
                    href={announcement.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Learn more
                  </a>
                </>
              ) : null}
            </p>
          </div>
          <Dismiss
            label="Hide this announcement"
            onDismiss={() => {
              hide('announcement', { kind: 'announcement', key: announcement.key });
            }}
          />
        </Banner>
      ) : null}
    </div>
  );
}
