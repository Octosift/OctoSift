import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluations, posts, runs, usage } from '../db/schema';
import { createRateLimiter } from '../reddit/ratelimit';
import { createProviderSource } from '../reddit/provider/source';
import { createVendorClient } from '../reddit/provider/vendor';
import { createFakeClock } from '../testing/fake-clock';
import { createScanHarness, HARNESS_NOW_MS } from '../testing/scan-harness';
import { runScan } from './run';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/provider', `${name}.json`), 'utf8'));

/** Feed answers are shifted so the synthetic posts are as old as in the fixtures. */
function shifted(name: string): string {
  const offset = HARNESS_NOW_MS / 1000 - 1_800_000_000;
  return JSON.stringify(fixture(name)).replace(
    /"createdAt":"([^"]+)"/g,
    (_, iso: string) => `"createdAt":"${new Date(Date.parse(iso) + offset * 1000).toISOString()}"`,
  );
}

function providerHarness() {
  const requests: URL[] = [];
  const fetchImpl = (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push(url);
    const body = url.pathname.endsWith('/post_details_batch')
      ? shifted('details')
      : url.searchParams.get('subreddit_name') !== 'freelance_demo'
        ? JSON.stringify({ code: 200, data: { subredditV3: { elements: { edges: [] } } } })
        : shifted(url.searchParams.get('after') ? 'feed-page-2' : 'feed-page-1');
    return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));
  };
  const clock = createFakeClock(HARNESS_NOW_MS);
  const source = createProviderSource({
    client: createVendorClient({
      key: () => 'synthetic-provider-key-0000',
      limiter: createRateLimiter({
        clock,
        random: () => 0,
        minSpacingMs: 0,
        maxJitterMs: 0,
        maxWaitMs: 1_000,
      }),
      clock,
      redact: (text) => text,
      fetchImpl,
    }),
    clock,
    maxPostAgeHours: () => 48,
    pricePerRequestUsd: () => 0.001,
    name: 'vendor',
  });
  const harness = createScanHarness('acme-invoices', {
    source,
    // Every synthetic post is relevant and a strong fit, so the funnel is easy to follow.
    respond: (request) => {
      if (request.task === 'triage') {
        return {
          output: {
            results: (request.subject.postIds ?? []).map((id) => ({
              id,
              relevant: true,
              why: 'Relevant',
            })),
          },
        };
      }
      if (request.task === 'qualify') {
        return {
          output: {
            fit: 'direct',
            intent: 'asking_for_recommendation',
            score: 90,
            reason: 'Asks for reminders',
            evidence_quote: '',
            mention_ok: true,
            dm_ok: false,
            suggested_angle: 'Share a reminder routine',
            risk_flags: [],
            alternatives_mentioned: [],
          },
        };
      }
      return undefined;
    },
  });
  return { harness, requests };
}

describe('a scan through a data provider', () => {
  it('filters previews for free, completes the survivors in one batch and counts the data cost', async () => {
    const { harness, requests } = providerHarness();
    const report = await runScan(harness.deps, { trigger: 'cli' });

    const details = requests.filter((url) =>
      url.pathname.endsWith('/post_details_batch'),
    );
    expect(details).toHaveLength(1);
    // The 80-hour-old post is not even stored on a first read, so it is never fetched in full.
    expect(details[0]?.searchParams.get('post_ids')?.split(',').sort()).toEqual([
      't3_prv001',
      't3_prv002',
      't3_prv003',
      't3_prv004',
    ]);

    const stored = new Map(
      harness.db
        .select()
        .from(posts)
        .all()
        .map((post) => [post.id, post]),
    );
    expect(stored.get('t3_prv001')).toMatchObject({ partial: false, score: 12, commentCount: 7 });
    expect(stored.get('t3_prv001')?.bodyText).toContain('https://docs.example.com/my-tracker');
    expect(stored.get('t3_prv004')?.partial).toBe(true);

    // Locked only shows in the full post, so it is filtered after completion.
    const locked = harness.db
      .select()
      .from(evaluations)
      .all()
      .find((row) => row.postId === 't3_prv002' && row.stage === 'prefilter');
    expect(locked).toMatchObject({ verdict: 'skip', reason: 'locked' });
    expect(report.counts.prefilter).toEqual({ pass: 3, skip: 1 });

    const billed = harness.db
      .select()
      .from(usage)
      .all()
      .filter((row) => row.stage === 'reddit_data');
    expect(billed.map((row) => row.model).sort()).toEqual([
      'vendor/details',
      'vendor/feed',
      'vendor/feed',
      'vendor/feed',
    ]);
    expect(harness.db.select().from(runs).get()?.dataCostUsd).toBeCloseTo(0.004);
  });

  it('stops paid reads at the budget and says so', async () => {
    const { harness, requests } = providerHarness();
    harness.settings.set('budget.perRunUsd', 0.0015);
    const report = await runScan(harness.deps, { trigger: 'cli' });
    expect(report.status).toBe('budget_stopped');
    expect(requests.length).toBeLessThanOrEqual(2);
  });
});
