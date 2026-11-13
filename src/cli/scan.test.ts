import { describe, expect, it } from 'vitest';
import { createScanHarness } from '../core/testing/scan-harness';
import { formatScanReport, parseScanArgs, runScanCommand } from './scan';

describe('parseScanArgs', () => {
  it('reads every supported flag', () => {
    expect(parseScanArgs(['--once', '--product', 'p1', '--json', '--dry-run'])).toEqual({
      ok: true,
      options: { productId: 'p1', json: true, dryRun: true },
    });
  });

  it('defaults to a full, saved, human-readable scan', () => {
    expect(parseScanArgs(['--once'])).toEqual({
      ok: true,
      options: { productId: undefined, json: false, dryRun: false },
    });
  });

  it('rejects unknown flags with the usage line', () => {
    const result = parseScanArgs(['--loop']);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('Usage: pnpm scan');
  });
});

describe('runScanCommand', () => {
  it('scans every watched subreddit and lists the new leads, best first', async () => {
    const harness = createScanHarness('acme-invoices');
    const result = await runScanCommand(harness.deps, {
      productId: undefined,
      json: false,
      dryRun: false,
    });
    expect(result.code).toBe(0);
    const lines = result.output.split('\n');
    expect(lines[0]).toMatch(
      /^Scan ok: 30 posts read, 29 new, 16 leads, 10 drafts, cost \$0\.0000/,
    );
    expect(lines[1]).toMatch(/^ +92 {2}r\/\w+_demo {2}.+ {2}\[draft ready\]$/);
  });

  it('prints the whole report as JSON when asked', async () => {
    const harness = createScanHarness('acme-plants');
    const result = await runScanCommand(harness.deps, {
      productId: undefined,
      json: true,
      dryRun: true,
    });
    const parsed = JSON.parse(result.output) as { status: string; counts: { leads: number } };
    expect(parsed.status).toBe('ok');
    expect(parsed.counts.leads).toBe(16);
  });

  it('exits with an error code when the scan fails', async () => {
    const harness = createScanHarness('acme-logs', {
      resolveModel: () => ({
        ok: false,
        kind: 'not_configured',
        message: 'Choose a model',
        model: null,
      }),
    });
    const result = await runScanCommand(harness.deps, {
      productId: undefined,
      json: false,
      dryRun: false,
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain('Note: Choose a model');
  });
});

describe('formatScanReport', () => {
  it('says when nothing new was found and when prices were unknown', async () => {
    const harness = createScanHarness('acme-logs');
    const { report } = await runScanCommand(harness.deps, {
      productId: undefined,
      json: false,
      dryRun: true,
    });
    const empty = { ...report, leads: [], costIncomplete: true };
    const output = formatScanReport(empty, { productId: undefined, json: false, dryRun: true });
    expect(output).toContain('(dry run, nothing saved)');
    expect(output).toContain('(some prices unknown)');
    expect(output).toContain('No new leads this time.');
  });
});
