import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { insertProduct, watchSubreddit } from '../db/queries/products';
import { silentLogger } from '../log';
import { runScan } from '../pipeline/run';
import { createSettingsStore } from '../settings/store';
import { createFakeClock } from '../testing/fake-clock';
import { DEMO_MISSING_SUBREDDIT, demoRuntimeOverrides } from './runtime';
import { loadSampleProduct } from './sample-products';

describe('demo mode overrides', () => {
  it('runs a full scan with no key and no network', async () => {
    const clock = createFakeClock();
    const overrides = demoRuntimeOverrides(clock);
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

  it('suggests real demo subreddits plus one that does not exist', async () => {
    const overrides = demoRuntimeOverrides(createFakeClock());
    const result = await overrides.source?.fetchNewPosts([DEMO_MISSING_SUBREDDIT], { limit: 10 });
    expect(result).toEqual({ ok: false, kind: 'gone' });
  });
});
