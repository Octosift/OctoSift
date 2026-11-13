/**
 * `scan`: runs one scan and prints the new leads.
 *
 * The CLI always runs a single scan and reads every watched subreddit,
 * regardless of the schedule; the worker is what runs scans on a schedule.
 */
import { parseArgs } from 'node:util';
import { CONFIG } from '../core/config';
import { runScan, type ScanDeps, type ScanReport } from '../core/pipeline/run';
import { acquireScanLock, heartbeatScanLock, releaseScanLock } from '../core/scan-lock';

export interface ScanCommandOptions {
  productId: string | undefined;
  json: boolean;
  dryRun: boolean;
}

export type ParsedScanArgs =
  { ok: true; options: ScanCommandOptions } | { ok: false; message: string };

export const SCAN_USAGE = 'Usage: pnpm scan --once [--product <id>] [--json] [--dry-run]';

export function parseScanArgs(argv: string[]): ParsedScanArgs {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        once: { type: 'boolean', default: false },
        product: { type: 'string' },
        json: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    return {
      ok: true,
      options: { productId: values.product, json: values.json, dryRun: values['dry-run'] },
    };
  } catch (error) {
    return {
      ok: false,
      message: `${error instanceof Error ? error.message : 'Invalid arguments'}\n${SCAN_USAGE}`,
    };
  }
}

function money(report: ScanReport): string {
  const amount = `$${report.costUsd.toFixed(4)}`;
  return report.costIncomplete ? `${amount} (some prices unknown)` : amount;
}

export function formatScanReport(report: ScanReport, options: ScanCommandOptions): string {
  if (options.json) return `${JSON.stringify(report, null, 2)}\n`;
  const { counts } = report;
  const lines = [
    `Scan ${report.status}${options.dryRun ? ' (dry run, nothing saved)' : ''}: ` +
      `${counts.fetched} posts read, ${counts.new} new, ${counts.leads} leads, ` +
      `${counts.drafts.reply} drafts, cost ${money(report)}`,
  ];
  if (report.error) lines.push(`Note: ${report.error}`);
  if (counts.blocked)
    lines.push('Reddit paused reads; the next scan will continue where this one stopped.');
  for (const lead of [...report.leads].sort((a, b) => b.score - a.score)) {
    lines.push(
      `  ${String(lead.score).padStart(3)}  r/${lead.subreddit}  ${lead.title}${lead.drafted ? '  [draft ready]' : ''}`,
      `       ${lead.url}`,
    );
  }
  if (report.leads.length === 0) lines.push('No new leads this time.');
  return `${lines.join('\n')}\n`;
}

export const SCAN_RUNNING_MESSAGE =
  'Another scan is running (the worker or another command). Try again in a minute.\n';

export async function runScanCommand(
  deps: ScanDeps,
  options: ScanCommandOptions,
): Promise<{ code: number; output: string; report: ScanReport | null }> {
  const owner = `cli-${process.pid}`;
  if (!acquireScanLock(deps.db, owner, deps.clock.nowMs(), CONFIG.schedule.lockStaleAfterMs)) {
    return { code: 1, output: SCAN_RUNNING_MESSAGE, report: null };
  }
  const lost = new AbortController();
  const heartbeat = setInterval(() => {
    if (lost.signal.aborted || heartbeatScanLock(deps.db, owner, deps.clock.nowMs())) return;
    lost.abort(new Error('Stopped early: another process took over the scan lock.'));
  }, CONFIG.schedule.lockHeartbeatMs);
  heartbeat.unref();
  try {
    const report = await runScan(deps, {
      trigger: 'cli',
      dryRun: options.dryRun,
      ignoreSchedule: true,
      signal: lost.signal,
      ...(options.productId ? { productId: options.productId } : {}),
    });
    return {
      code: report.status === 'failed' ? 1 : 0,
      output: formatScanReport(report, options),
      report,
    };
  } finally {
    clearInterval(heartbeat);
    releaseScanLock(deps.db, owner);
  }
}
