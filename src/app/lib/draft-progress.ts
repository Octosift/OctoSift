/**
 * Live steps of the drafts being written on request, so the editor can show
 * what is happening while the user waits. Kept in memory on globalThis: the
 * server action that writes and the route that reports run in one process,
 * but in separate module graphs.
 */
import 'server-only';
import type { DraftKind } from '@/core/db/schema';
import type { DraftStep } from '@/core/pipeline/draft';

export type DraftProgressStep = DraftStep & { kind: DraftKind; at: number };

export interface DraftProgress {
  startedAt: number;
  steps: DraftProgressStep[];
  finished: boolean;
}

/** How long a finished entry stays readable for a last poll. */
const KEEP_FINISHED_MS = 30_000;

const holder = globalThis as typeof globalThis & {
  draftProgress?: Map<string, DraftProgress>;
};

function store(): Map<string, DraftProgress> {
  holder.draftProgress ??= new Map();
  return holder.draftProgress;
}

export function startDraftProgress(
  leadId: string,
  now: () => number = Date.now,
): {
  push: (kind: DraftKind, step: DraftStep) => void;
  finish: () => void;
} {
  const entry: DraftProgress = { startedAt: now(), steps: [], finished: false };
  store().set(leadId, entry);
  return {
    push: (kind, step) => {
      entry.steps.push({ ...step, kind, at: now() });
    },
    finish: () => {
      entry.finished = true;
      setTimeout(() => {
        if (store().get(leadId) === entry) store().delete(leadId);
      }, KEEP_FINISHED_MS).unref();
    },
  };
}

export function readDraftProgress(leadId: string): DraftProgress | null {
  return store().get(leadId) ?? null;
}
