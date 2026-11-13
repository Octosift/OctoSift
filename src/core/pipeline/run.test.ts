import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { evaluations, leads, posts, runs, subreddits, usage, drafts } from '../db/schema';
import type { GoldenOutcome } from '../eval/golden';
import { createScanHarness } from '../testing/scan-harness';
import { SAMPLE_PRODUCT_SLUGS, type SampleProductSlug } from '../demo/sample-products';
import { emptyCounts } from './funnel';
import { runScan } from './run';

const DM_PRODUCTS: Record<SampleProductSlug, number> = {
  'acme-invoices': 1,
  'acme-plants': 0,
  'acme-logs': 1,
};

describe.each(SAMPLE_PRODUCT_SLUGS)('a first scan for %s', (slug) => {
  it('produces the exact funnel the golden labels describe', async () => {
    const harness = createScanHarness(slug);
    const report = await runScan(harness.deps, { trigger: 'cli' });
    expect(report.status).toBe('ok');
    expect(report.counts).toEqual({
      ...emptyCounts(),
      fetched: 30,
      // The post older than 48 hours is not stored on a subreddit's first poll.
      new: 29,
      prefilter: { pass: 25, skip: 4 },
      brandMentions: 1,
      triage: { pass: 20, skip: 4, error: 0 },
      qualify: { pass: 20, error: 0 },
      veto: { pass: 16, skip: 4 },
      leads: 16,
      drafts: { reply: 10, dm: DM_PRODUCTS[slug], rejected: 0, failed: 0 },
    });
    expect(report.leads).toHaveLength(16);
  });

  it('leaves every post at the outcome its label expects', async () => {
    const harness = createScanHarness(slug);
    await runScan(harness.deps, { trigger: 'cli' });
    const { db, productId } = harness;
    const verdict = (postId: string, stage: 'prefilter' | 'triage' | 'veto') =>
      db
        .select()
        .from(evaluations)
        .where(and(eq(evaluations.postId, postId), eq(evaluations.stage, stage)))
        .get();
    const leadFor = (postId: string) =>
      db
        .select()
        .from(leads)
        .where(and(eq(leads.productId, productId), eq(leads.postId, postId)))
        .get();

    for (const post of harness.golden.posts) {
      const expected: GoldenOutcome = post.label.expect;
      const context = `${post.id} (${post.label.category})`;
      const lead = leadFor(post.id);
      switch (expected) {
        case 'lead':
          expect(lead?.kind, context).toBe('opportunity');
          expect(lead?.status === 'drafted', context).toBe(post.label.draft);
          break;
        case 'brand_mention':
          expect(lead?.kind, context).toBe('brand_mention');
          break;
        case 'below_threshold':
        case 'veto':
          expect(verdict(post.id, 'veto')?.verdict, context).toBe('skip');
          expect(lead, context).toBeUndefined();
          break;
        case 'triage_skip':
          expect(verdict(post.id, 'triage')?.verdict, context).toBe('skip');
          break;
        case 'prefilter_skip':
          expect(verdict(post.id, 'prefilter')?.verdict, context).toBe('skip');
          break;
        case 'crosspost':
          expect(verdict(post.id, 'prefilter')?.reason, context).toBe('crosspost');
          break;
        case 'too_old':
          expect(
            db.select().from(posts).where(eq(posts.id, post.id)).get(),
            context,
          ).toBeUndefined();
          break;
      }
    }
  });
});

describe('runScan', () => {
  it('stores a reason for every verdict and a draft that passed review', async () => {
    const harness = createScanHarness('acme-invoices');
    await runScan(harness.deps, { trigger: 'cli' });
    const rows = harness.db.select().from(evaluations).all();
    expect(rows.every((row) => row.reason.length > 0)).toBe(true);
    const lead = harness.db.select().from(leads).where(eq(leads.postId, 't3_inv01')).get();
    const stored = harness.db
      .select()
      .from(drafts)
      .where(eq(drafts.leadId, lead?.id ?? ''))
      .all();
    expect(stored.map((draft) => [draft.kind, draft.mode, draft.reviewDecision]).sort()).toEqual([
      ['dm', 'direct', 'APPROVE'],
      ['reply', 'direct', 'APPROVE'],
    ]);
  });

  it('does not judge the same posts again on the next scan', async () => {
    const harness = createScanHarness('acme-logs');
    await runScan(harness.deps, { trigger: 'cli' });
    const callsAfterFirst = harness.generator.calls.length;
    harness.clock.advance(61 * 60 * 1000);
    const second = await runScan(harness.deps, { trigger: 'schedule' });
    expect(second.counts.new).toBe(0);
    expect(second.counts.prefilter).toEqual({ pass: 0, skip: 0 });
    expect(harness.generator.calls.length).toBe(callsAfterFirst);
  });

  it('skips subreddits that are not due yet', async () => {
    const harness = createScanHarness('acme-logs');
    await runScan(harness.deps, { trigger: 'cli' });
    harness.clock.advance(10 * 60 * 1000);
    const second = await runScan(harness.deps, { trigger: 'schedule' });
    expect(second.counts.fetched).toBe(0);
  });

  it('writes nothing but the run row in a dry run', async () => {
    const harness = createScanHarness('acme-plants');
    harness.settings.set('ai.prices', {
      'fake-triage': { inputPerMillionUsd: 1, outputPerMillionUsd: 1 },
    });
    const report = await runScan(harness.deps, { trigger: 'cli', dryRun: true });
    expect(report.counts.leads).toBe(16);
    expect(report.costUsd).toBeGreaterThan(0);
    const { db } = harness;
    expect(db.select().from(posts).all()).toEqual([]);
    expect(db.select().from(evaluations).all()).toEqual([]);
    expect(db.select().from(leads).all()).toEqual([]);
    expect(db.select().from(usage).all()).toEqual([]);
    expect(
      db
        .select()
        .from(subreddits)
        .all()
        .map((row) => row.lastPolledAt),
    ).toEqual([null, null]);
    expect(db.select().from(runs).get()).toMatchObject({ dryRun: true, status: 'ok' });
  });

  it('stops cleanly at the budget and continues from there on the next scan', async () => {
    const harness = createScanHarness('acme-invoices');
    harness.settings.set('ai.prices', {
      'fake-triage': { inputPerMillionUsd: 1_000, outputPerMillionUsd: 1_000 },
    });
    harness.settings.set('budget.perRunUsd', 0.5);
    const first = await runScan(harness.deps, { trigger: 'cli' });
    expect(first.status).toBe('budget_stopped');
    expect(first.error).toMatch(/budget/);
    expect(first.counts.leads).toBe(0);

    harness.settings.set('ai.prices', {});
    harness.clock.advance(61 * 60 * 1000);
    const second = await runScan(harness.deps, { trigger: 'schedule' });
    expect(second.status).toBe('ok');
    expect(first.counts.leads + second.counts.leads).toBe(16);
  });

  it('reports a missing model setup and leaves posts retryable', async () => {
    const harness = createScanHarness('acme-plants', {
      resolveModel: () => ({
        ok: false,
        kind: 'not_configured',
        message: 'Choose a model for the triage stage in Settings.',
        model: null,
      }),
    });
    const report = await runScan(harness.deps, { trigger: 'cli' });
    expect(report.status).toBe('failed');
    expect(report.error).toBe('Choose a model for the triage stage in Settings.');
    expect(report.counts.prefilter.pass).toBe(25);
    expect(report.counts.leads).toBe(0);
  });

  it('stops AI work when too many calls fail', async () => {
    const harness = createScanHarness('acme-logs', {
      respond: () => ({ fail: 'provider_error', message: 'upstream overloaded' }),
    });
    const report = await runScan(harness.deps, { trigger: 'cli' });
    expect(report.status).toBe('failed');
    expect(report.error).toContain('upstream overloaded');
    expect(harness.generator.calls.length).toBeLessThan(10);
  });

  it('records a Reddit block and when reads may resume', async () => {
    const harness = createScanHarness('acme-invoices', {
      source: {
        fetchNewPosts: () =>
          Promise.resolve({ ok: false, kind: 'blocked', retryAfterS: 600, message: 'HTTP 403' }),
      },
    });
    const report = await runScan(harness.deps, { trigger: 'cli' });
    expect(report.status).toBe('partial');
    expect(report.counts.blocked).toBe(true);
    const nowS = Math.floor(harness.clock.nowMs() / 1000);
    const rows = harness.db.select().from(subreddits).all();
    expect(rows.map((row) => row.blockUntil)).toEqual([nowS + 600, nowS + 600]);
  });

  it('marks a subreddit that no longer exists', async () => {
    const harness = createScanHarness('acme-invoices', {
      source: {
        fetchNewPosts: (names) =>
          Promise.resolve(
            names.includes('smallbiz_demo')
              ? { ok: false, kind: 'gone' }
              : { ok: true, posts: [], rate: { used: 1, remaining: 1, resetS: 1 } },
          ),
      },
    });
    await runScan(harness.deps, { trigger: 'cli' });
    const row = harness.db
      .select()
      .from(subreddits)
      .where(eq(subreddits.name, 'smallbiz_demo'))
      .get();
    expect(row?.status).toBe('gone');
  });

  it('saves the funnel counts while the scan runs', async () => {
    const harness = createScanHarness('acme-plants');
    const seen: number[] = [];
    const respond = harness.generator;
    harness.deps.generator = (request) => {
      const run = harness.db.select().from(runs).get();
      const counts = run?.countsJson as { prefilter?: { pass: number } } | undefined;
      seen.push(counts?.prefilter?.pass ?? -1);
      return respond(request);
    };
    await runScan(harness.deps, { trigger: 'cli' });
    expect(seen[0]).toBe(25);
  });

  it('notifies about strong leads', async () => {
    const harness = createScanHarness('acme-invoices');
    const notices: number[] = [];
    harness.deps.notify = (notice) => {
      notices.push(notice.score);
      return Promise.resolve(true);
    };
    await runScan(harness.deps, { trigger: 'cli' });
    expect(notices.length).toBe(6);
    expect(notices.every((score) => score >= 85)).toBe(true);
    const notified = harness.db
      .select()
      .from(leads)
      .all()
      .filter((lead) => lead.notifiedAt !== null);
    expect(notified).toHaveLength(6);
  });
});
