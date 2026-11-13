/** Counts for each stage of one scan; stored with the run and shown in the dashboard. */

export interface FunnelCounts {
  /** Feed entries returned by Reddit. */
  fetched: number;
  /** Entries not seen before, stored by this scan. */
  new: number;
  prefilter: { pass: number; skip: number };
  brandMentions: number;
  triage: { pass: number; skip: number; error: number };
  qualify: { pass: number; error: number };
  /** pass: became a lead; skip: vetoed or below the inbox threshold. */
  veto: { pass: number; skip: number };
  leads: number;
  drafts: { reply: number; dm: number; rejected: number; failed: number };
  redditErrors: number;
  blocked: boolean;
}

export function emptyCounts(): FunnelCounts {
  return {
    fetched: 0,
    new: 0,
    prefilter: { pass: 0, skip: 0 },
    brandMentions: 0,
    triage: { pass: 0, skip: 0, error: 0 },
    qualify: { pass: 0, error: 0 },
    veto: { pass: 0, skip: 0 },
    leads: 0,
    drafts: { reply: 0, dm: 0, rejected: 0, failed: 0 },
    redditErrors: 0,
    blocked: false,
  };
}
