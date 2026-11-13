import { describe, expect, it } from 'vitest';
import { runScan } from '../../pipeline/run';
import { createScanHarness } from '../../testing/scan-harness';
import { setSubredditEnabled } from './products';
import { subredditStats } from './stats';

describe('subredditStats', () => {
  it('counts posts seen and leads found per subreddit for one product', async () => {
    const harness = createScanHarness('acme-invoices');
    await runScan(harness.deps, { trigger: 'cli' });
    setSubredditEnabled(harness.db, harness.productId, 'smallbiz_demo', false);
    const stats = subredditStats(harness.db, harness.productId);
    expect(stats.map((row) => [row.name, row.enabled, row.status])).toEqual([
      ['freelance_demo', true, 'active'],
      ['smallbiz_demo', false, 'active'],
    ]);
    expect(stats.reduce((sum, row) => sum + row.postsSeen, 0)).toBe(29);
    expect(stats.reduce((sum, row) => sum + row.leads, 0)).toBe(16);
    expect(stats[0]?.lastPolledAt).not.toBeNull();
  });
});
