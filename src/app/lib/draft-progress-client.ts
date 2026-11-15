/**
 * The browser's only request outside server actions: it asks this app's own
 * server how far a draft has got. Server actions run one at a time, so the
 * progress cannot be read with one while the draft action is running.
 */
import type { DraftProgress } from './draft-progress';

export type DraftProgressReply = DraftProgress & { now: number };

export async function fetchDraftProgress(leadId: string): Promise<DraftProgressReply> {
  const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/draft-progress`, {
    cache: 'no-store',
  });
  return (await response.json()) as DraftProgressReply;
}
