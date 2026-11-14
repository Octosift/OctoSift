/**
 * Turns recent scans into warnings the dashboard shows as banners.
 *
 * "Fail quietly, report loudly": a scan never crashes on a bad fetch or a
 * failed AI call, so a pipeline that keeps producing nothing has to be
 * pointed out, with the likely cause in plain language.
 */
import { z } from 'zod';
import { CONFIG } from '../config';
import type { Db } from '../db/client';
import { enabledSubredditNames } from '../db/queries/products';
import { recentRuns, type RunRow } from '../db/queries/runs';
import { readState } from '../state';
import { accountProblem } from './account-check';
import { removedReplySubreddits } from './visibility';

export type HealthIssue =
  | { kind: 'reddit_paused'; severity: 'warning'; resumesAt: number; message: string }
  | { kind: 'ai_stopped'; severity: 'error'; message: string }
  | { kind: 'budget'; severity: 'warning'; message: string }
  | { kind: 'no_leads'; severity: 'warning'; message: string; causes: string[] }
  | { kind: 'no_fetch'; severity: 'warning'; message: string; causes: string[] }
  | { kind: 'session_reauth'; severity: 'error'; message: string; reason: string }
  | { kind: 'account_hidden'; severity: 'error'; message: string; reason: string }
  | { kind: 'source_failover'; severity: 'warning'; message: string; reason: string }
  | { kind: 'replies_removed'; severity: 'warning' | 'error'; message: string; reason: string };

const countsSchema = z.object({
  fetched: z.number().catch(0),
  prefilter: z.object({ pass: z.number(), skip: z.number() }).catch({ pass: 0, skip: 0 }),
  triage: z
    .object({ pass: z.number(), skip: z.number(), error: z.number() })
    .catch({ pass: 0, skip: 0, error: 0 }),
  qualify: z.object({ pass: z.number(), error: z.number() }).catch({ pass: 0, error: 0 }),
  veto: z.object({ pass: z.number(), skip: z.number() }).catch({ pass: 0, skip: 0 }),
  leads: z.number().catch(0),
  blocked: z.boolean().catch(false),
});
type RunCounts = z.output<typeof countsSchema>;

function countsOf(run: RunRow): RunCounts {
  return countsSchema.catch(countsSchema.parse({})).parse(run.countsJson);
}

export interface HealthInput {
  /** Newest first; dry runs are ignored. */
  runs: RunRow[];
  /** Epoch seconds, from the stored Reddit pause. */
  redditPausedUntil: number | null;
  hasSubreddits: boolean;
  now: number;
  /** Why the connected Reddit account needs reconnecting, when it does. */
  sessionProblem?: string | null;
  /** The connected account's profile was suspended or not found on two checks in a row. */
  accountProblem?: { username: string; status: 'suspended' | 'missing' } | null;
  /** The last switch away from the preferred source, if it has not recovered since. */
  failover?: { from: string; to: string | null; reason: string } | null;
  /** Subreddits where one of your replies was removed in the last week. */
  removedReplies?: string[];
}

const SOURCE_NAMES: Readonly<Record<string, string>> = {
  session: 'your Reddit account',
  rss: 'public RSS feeds',
};

function likelyCausesOfNoLeads(counts: RunCounts[]): string[] {
  const total = counts.reduce(
    (sum, run) => ({
      prefilterPass: sum.prefilterPass + run.prefilter.pass,
      triagePass: sum.triagePass + run.triage.pass,
      triageSkip: sum.triageSkip + run.triage.skip,
      errors: sum.errors + run.triage.error + run.qualify.error,
      vetoSkip: sum.vetoSkip + run.veto.skip,
      blocked: sum.blocked || run.blocked,
    }),
    { prefilterPass: 0, triagePass: 0, triageSkip: 0, errors: 0, vetoSkip: 0, blocked: false },
  );
  const causes: string[] = [];
  if (total.errors > 0)
    causes.push('Some AI calls failed. Check your provider settings and the Runs page.');
  if (total.blocked) causes.push('Reddit blocked some reads, so fewer posts were checked.');
  if (total.prefilterPass === 0) {
    causes.push(
      'Every post was filtered out before the AI stages. Check the blocklist, languages and maximum post age.',
    );
  } else if (total.triagePass === 0 && total.triageSkip > 0) {
    causes.push(
      'Triage found nothing relevant. The subreddits may not be where your customers ask questions, or the profile may be too narrow.',
    );
  } else if (total.vetoSkip > 0) {
    causes.push(
      'Posts were judged but scored below your inbox threshold or were vetoed. Your thresholds may be too high.',
    );
  }
  if (causes.length === 0) causes.push('Try different subreddits or broaden the product profile.');
  return causes;
}

export function computeHealth(input: HealthInput): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const runs = input.runs.filter((run) => !run.dryRun && run.status !== 'running');
  const latest = runs[0];

  if (input.sessionProblem) {
    issues.push({
      kind: 'session_reauth',
      severity: 'error',
      message: 'Reconnect your Reddit account.',
      reason: input.sessionProblem,
    });
  }
  if (input.accountProblem) {
    const { username, status } = input.accountProblem;
    issues.push(
      status === 'suspended'
        ? {
            kind: 'account_hidden',
            severity: 'error',
            message: `Reddit suspended the connected account u/${username}.`,
            reason: 'Reads with it will stop working soon',
          }
        : {
            kind: 'account_hidden',
            severity: 'error',
            message: `The connected account u/${username} has no public profile.`,
            reason:
              'Reddit answers "not found" for it, which usually means the account is shadowbanned or was deleted',
          },
    );
  }
  const removed = input.removedReplies ?? [];
  if (removed.length === 1) {
    issues.push({
      kind: 'replies_removed',
      severity: 'warning',
      message: `Your reply in r/${removed[0] ?? ''} was removed or is not visible to others.`,
      reason:
        'A subreddit filter often holds new or linked comments. Ask the moderators, or post without links',
    });
  } else if (removed.length > 1) {
    issues.push({
      kind: 'replies_removed',
      severity: 'error',
      message: `Your replies were removed in ${removed.map((name) => `r/${name}`).join(', ')} this week.`,
      reason:
        'Reddit may be hiding comments from your account. Pause product mentions and links, and check the account',
    });
  }
  if (input.failover) {
    const from = SOURCE_NAMES[input.failover.from] ?? input.failover.from;
    const to = input.failover.to ? (SOURCE_NAMES[input.failover.to] ?? input.failover.to) : null;
    issues.push({
      kind: 'source_failover',
      severity: 'warning',
      message: to
        ? `Reading Reddit through ${to}, because ${from} stopped working.`
        : `Reddit could not be read: ${from} stopped working and no other source is set up.`,
      reason: input.failover.reason,
    });
  }

  if (input.redditPausedUntil !== null && input.redditPausedUntil > input.now) {
    issues.push({
      kind: 'reddit_paused',
      severity: 'warning',
      resumesAt: input.redditPausedUntil,
      message: 'Reddit is limiting requests from this network, so reading is paused for a while.',
    });
  }
  if (latest?.status === 'failed') {
    issues.push({
      kind: 'ai_stopped',
      severity: 'error',
      message: latest.error ?? 'The last scan failed. See the Runs page for details.',
    });
  } else if (latest?.status === 'budget_stopped') {
    issues.push({
      kind: 'budget',
      severity: 'warning',
      message: latest.error ?? 'The last scan stopped at the budget cap.',
    });
  }

  const window = CONFIG.health.scansWithoutLeadsBeforeWarning;
  const lastFew = runs.slice(0, window).map(countsOf);
  if (lastFew.length === window && lastFew.every((run) => run.fetched > 0 && run.leads === 0)) {
    issues.push({
      kind: 'no_leads',
      severity: 'warning',
      message: `The last ${window} scans read posts but found no leads.`,
      causes: likelyCausesOfNoLeads(lastFew),
    });
  }

  const oldest = runs.at(-1);
  if (input.hasSubreddits && oldest) {
    const lastFetch = runs.find((run) => countsOf(run).fetched > 0)?.startedAt ?? oldest.startedAt;
    const hours = (input.now - lastFetch) / 3600;
    if (hours > CONFIG.health.hoursWithoutFetchBeforeWarning) {
      issues.push({
        kind: 'no_fetch',
        severity: 'warning',
        message: `No posts have been read from Reddit for ${Math.floor(hours)} hours.`,
        causes: [
          'Check that the worker is running (pnpm start or docker compose up).',
          'Reddit may be blocking reads: connect a Reddit account or choose another data source in Settings.',
        ],
      });
    }
  }
  return issues;
}

export function loadHealth(db: Db, now: number): HealthIssue[] {
  const session = readState(db, 'state.redditSession');
  return computeHealth({
    runs: recentRuns(db, 10),
    redditPausedUntil: readState(db, 'state.redditPausedUntil'),
    hasSubreddits: enabledSubredditNames(db).length > 0,
    now,
    sessionProblem:
      session?.status === 'needs_reauth' ? (session.reason ?? 'Reddit refused it') : null,
    accountProblem: session?.status === 'connected' ? accountProblem(db, session.username) : null,
    failover: readState(db, 'state.sourceFailover'),
    removedReplies: removedReplySubreddits(db, now),
  });
}
