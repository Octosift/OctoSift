import { describe, expect, it } from 'vitest';
import { runScan } from '../../pipeline/run';
import { createScanHarness } from '../../testing/scan-harness';
import { writeState } from '../../state';
import { deleteAllData, exportData } from './data';

describe('data export and deletion', () => {
  it('exports collected data without secrets or internal state', async () => {
    const harness = createScanHarness('acme-logs');
    await runScan(harness.deps, { trigger: 'cli' });
    harness.settings.set('budget.perDayUsd', 5);
    writeState(harness.db, 'state.redditPausedUntil', 1);
    const exported = exportData(harness.db);
    expect(exported.leads).toHaveLength(17);
    expect(exported.settings.map((row) => row.key)).toEqual(['budget.perDayUsd']);
    expect(Object.keys(exported)).not.toContain('secrets');
  });

  it('deletes everything', async () => {
    const harness = createScanHarness('acme-logs');
    await runScan(harness.deps, { trigger: 'cli' });
    deleteAllData(harness.db);
    const exported = exportData(harness.db);
    expect(Object.values(exported).every((rows) => rows.length === 0)).toBe(true);
  });
});
