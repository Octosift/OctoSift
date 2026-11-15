'use client';

import { Check, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DraftProgress, DraftProgressStep } from '../../lib/draft-progress';
import { fetchDraftProgress } from '../../lib/draft-progress-client';

const POLL_MS = 700;

function label(step: DraftProgressStep): string {
  const what = step.kind === 'dm' ? 'private message' : 'reply';
  switch (step.step) {
    case 'write':
      return `Writing the ${what}`;
    case 'fix':
      return 'Fixing what the automatic checks found';
    case 'review':
      return 'A second model checks it the way a moderator would';
    case 'revise':
      return "Rewriting with the reviewer's notes";
    case 'recheck':
      return 'Checking the new version';
  }
}

function seconds(ms: number): string {
  return `${String(Math.max(0, Math.round(ms / 1000)))} s`;
}

/**
 * The steps of a draft being written, read from the server while mounted.
 * A reviewed draft takes two to six model calls, so the wait is explained.
 * Mount it only while the request runs, so every request starts empty.
 */
export function DraftSteps({ leadId }: { leadId: string }) {
  const [progress, setProgress] = useState<DraftProgress | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Server time minus browser time; step times come from the server.
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const data = await fetchDraftProgress(leadId);
        if (stopped) return;
        setOffset(data.now - Date.now());
        // A finished entry belongs to an earlier request; this one has not started yet.
        if (!data.finished) setProgress(data);
      } catch {
        // The steps are a courtesy; the draft still arrives without them.
      }
      if (!stopped) setNow(Date.now());
    }
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [leadId]);

  const steps = progress?.steps ?? [];
  const serverNow = now + offset;
  const started = progress?.startedAt ?? serverNow;
  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-border px-3 py-2.5">
      <ol className="flex flex-col gap-1.5 text-[13px]">
        {steps.length === 0 ? (
          <li className="flex items-center gap-2">
            <LoaderCircle className="size-3.5 animate-spin text-brand" aria-hidden />
            Starting
          </li>
        ) : null}
        {steps.map((step, index) => {
          const next = steps[index + 1];
          const current = next === undefined;
          return (
            <li key={`${String(step.at)}-${step.step}`} className="flex items-start gap-2">
              {current ? (
                <LoaderCircle
                  className="mt-0.5 size-3.5 shrink-0 animate-spin text-brand"
                  aria-hidden
                />
              ) : (
                <Check className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className={current ? 'font-medium' : 'text-muted-foreground'}>
                  {label(step)}
                </span>
                {'detail' in step && step.detail ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {step.detail}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                {seconds((next?.at ?? serverNow) - step.at)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
        {seconds(serverNow - started)} so far. Each draft is written, then checked by a second
        model; if the check asks for changes, it is rewritten once and checked again.
      </p>
    </div>
  );
}
