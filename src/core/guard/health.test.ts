import { describe, expect, it } from 'vitest';
import type { RunRow } from '../db/queries/runs';
import { emptyCounts, type FunnelCounts } from '../pipeline/funnel';
import { computeHealth, type HealthInput } from './health';

const NOW = 1_800_000_000;
const HOUR = 3600;

function run(
  hoursAgo: number,
  counts: Partial<FunnelCounts>,
  overrides: Partial<RunRow> = {},
): RunRow {
  return {
    id: `run-${hoursAgo}`,
    startedAt: NOW - hoursAgo * HOUR,
    finishedAt: NOW - hoursAgo * HOUR + 60,
    trigger: 'schedule',
    status: 'ok',
    dryRun: false,
    countsJson: { ...emptyCounts(), ...counts },
    costUsd: 0,
    costIncomplete: false,
    error: null,
    ...overrides,
  };
}

const productive = { fetched: 100, prefilter: { pass: 20, skip: 5 }, leads: 2 };
const empty = { fetched: 100, prefilter: { pass: 20, skip: 5 }, leads: 0 };

function health(input: Partial<HealthInput>) {
  return computeHealth({
    runs: [],
    redditPausedUntil: null,
    hasSubreddits: true,
    now: NOW,
    ...input,
  });
}

describe('computeHealth', () => {
  it('asks to reconnect a Reddit account that stopped working', () => {
    expect(health({ sessionProblem: 'Reddit asked to sign in again' })).toEqual([
      {
        kind: 'session_reauth',
        severity: 'error',
        message: 'Reconnect your Reddit account.',
        reason: 'Reddit asked to sign in again',
      },
    ]);
  });

  it('warns about a removed reply, and more strongly when it happens in several subreddits', () => {
    expect(health({ removedReplies: ['freelance_demo'] })).toMatchObject([
      {
        kind: 'replies_removed',
        severity: 'warning',
        message: 'Your reply in r/freelance_demo was removed or is not visible to others.',
      },
    ]);
    expect(health({ removedReplies: ['freelance_demo', 'smallbiz_demo'] })).toMatchObject([
      {
        kind: 'replies_removed',
        severity: 'error',
        message: 'Your replies were removed in r/freelance_demo, r/smallbiz_demo this week.',
      },
    ]);
  });

  it('reports a connected account that is suspended or has no public profile', () => {
    expect(
      health({ accountProblem: { username: 'demo_reader', status: 'suspended' } }),
    ).toMatchObject([
      {
        kind: 'account_hidden',
        severity: 'error',
        message: 'Reddit suspended the connected account u/demo_reader.',
      },
    ]);
    expect(
      health({ accountProblem: { username: 'demo_reader', status: 'missing' } }),
    ).toMatchObject([
      {
        kind: 'account_hidden',
        message: 'The connected account u/demo_reader has no public profile.',
      },
    ]);
  });

  it('explains a switch to another source, or that none was left', () => {
    expect(
      health({ failover: { from: 'session', to: 'rss', reason: 'Reddit refused the session' } }),
    ).toMatchObject([
      {
        kind: 'source_failover',
        message:
          'Reading Reddit through public RSS feeds, because your Reddit account stopped working.',
      },
    ]);
    expect(health({ failover: { from: 'rss', to: null, reason: 'Blocked' } })[0]?.message).toBe(
      'Reddit could not be read: public RSS feeds stopped working and no other source is set up.',
    );
  });

  it('reports nothing when scans are finding leads', () => {
    expect(health({ runs: [run(1, productive), run(2, productive), run(3, productive)] })).toEqual(
      [],
    );
  });

  it('reports a Reddit pause with the time reading resumes', () => {
    expect(health({ redditPausedUntil: NOW + 600 })).toEqual([
      expect.objectContaining({ kind: 'reddit_paused', resumesAt: NOW + 600 }),
    ]);
  });

  it('ignores a pause that has already ended', () => {
    expect(health({ redditPausedUntil: NOW - 1 })).toEqual([]);
  });

  it('shows the error of a scan that failed', () => {
    const failed = run(1, productive, {
      status: 'failed',
      error: 'Choose a model for the triage stage in Settings.',
    });
    expect(health({ runs: [failed] })).toEqual([
      {
        kind: 'ai_stopped',
        severity: 'error',
        message: 'Choose a model for the triage stage in Settings.',
      },
    ]);
  });

  it('shows a budget stop', () => {
    const stopped = run(1, productive, { status: 'budget_stopped', error: 'Budget reached' });
    expect(health({ runs: [stopped] })[0]).toMatchObject({
      kind: 'budget',
      message: 'Budget reached',
    });
  });

  it('warns after three scans that read posts but found no leads', () => {
    const issues = health({ runs: [run(1, empty), run(2, empty), run(3, empty)] });
    expect(issues[0]).toMatchObject({ kind: 'no_leads' });
  });

  it('does not warn when one of the last three scans found leads', () => {
    expect(health({ runs: [run(1, empty), run(2, productive), run(3, empty)] })).toEqual([]);
  });

  it.each<[string, Partial<FunnelCounts>, RegExp]>([
    ['AI errors', { ...empty, triage: { pass: 0, skip: 0, error: 4 } }, /AI calls failed/],
    ['everything filtered', { ...empty, prefilter: { pass: 0, skip: 40 } }, /filtered out/],
    [
      'nothing relevant',
      { ...empty, triage: { pass: 0, skip: 20, error: 0 } },
      /Triage found nothing/,
    ],
    [
      'thresholds',
      { ...empty, triage: { pass: 5, skip: 15, error: 0 }, veto: { pass: 0, skip: 5 } },
      /thresholds/,
    ],
    ['a block', { ...empty, blocked: true }, /blocked/],
  ])('explains the likely cause: %s', (_label, counts, cause) => {
    const issues = health({ runs: [run(1, counts), run(2, counts), run(3, counts)] });
    const noLeads = issues.find((issue) => issue.kind === 'no_leads');
    expect(noLeads && 'causes' in noLeads ? noLeads.causes.join(' ') : '').toMatch(cause);
  });

  it('warns when no posts were read for more than 24 hours', () => {
    const issues = health({ runs: [run(1, { fetched: 0 }), run(30, productive)] });
    expect(issues).toEqual([expect.objectContaining({ kind: 'no_fetch' })]);
  });

  it('does not warn about reading on a fresh install or without subreddits', () => {
    expect(health({ runs: [] })).toEqual([]);
    expect(health({ runs: [run(30, { fetched: 0 })], hasSubreddits: false })).toEqual([]);
  });

  it('ignores dry runs', () => {
    const dry = run(1, empty, { dryRun: true, status: 'failed', error: 'x' });
    expect(health({ runs: [dry] })).toEqual([]);
  });
});
