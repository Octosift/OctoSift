import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { insertProduct, watchSubreddit } from '../db/queries/products';
import { silentLogger } from '../log';
import { runScan } from '../pipeline/run';
import { createSettingsStore } from '../settings/store';
import { createFakeClock } from '../testing/fake-clock';
import { DEMO_MISSING_SUBREDDIT, DEMO_QUIET_SUBREDDITS, demoRuntimeOverrides } from './runtime';
import { loadSampleProduct } from './sample-products';

const NO_LATENCY = { redditMs: 0, modelMs: 0 };

describe('demo mode overrides', () => {
  it('runs a full scan with no key and no network', async () => {
    const clock = createFakeClock();
    const overrides = demoRuntimeOverrides(clock, NO_LATENCY);
    const db = openMemoryDatabase();
    const now = Math.floor(clock.nowMs() / 1000);
    insertProduct(db, { id: 'demo', profile: loadSampleProduct('acme-invoices'), now });
    for (const name of ['freelance_demo', 'smallbiz_demo', DEMO_MISSING_SUBREDDIT]) {
      watchSubreddit(db, 'demo', name, now);
    }
    const { source, generator, resolveModel } = overrides;
    if (!source || !generator || !resolveModel) throw new Error('incomplete overrides');
    const report = await runScan(
      {
        db,
        source,
        generator,
        resolveModel,
        settings: createSettingsStore(db),
        clock,
        random: () => 0.5,
        log: silentLogger(),
        redact: (text) => text,
      },
      { trigger: 'manual' },
    );
    expect(report.status).toBe('ok');
    expect(report.counts.leads).toBe(16);
  });

  it('knows a quiet subreddit with no posts and rejects one that does not exist', async () => {
    const overrides = demoRuntimeOverrides(createFakeClock(), NO_LATENCY);
    const quiet = await overrides.source?.fetchNewPosts([DEMO_QUIET_SUBREDDITS['acme-invoices']], {
      limit: 10,
    });
    expect(quiet).toMatchObject({ ok: true, posts: [] });
    const missing = await overrides.source?.fetchNewPosts([DEMO_MISSING_SUBREDDIT], { limit: 10 });
    expect(missing).toEqual({ ok: false, kind: 'gone' });
  });
});
