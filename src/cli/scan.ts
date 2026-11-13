/**
 * `scan`: runs one scan and prints the new leads.
 *
 * The CLI always runs a single scan and reads every watched subreddit,
 * regardless of the schedule; the worker is what runs scans on a schedule.
 */
import { parseArgs } from 'node:util';
import { runScan, type ScanDeps, type ScanReport } from '../core/pipeline/run';

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

export async function runScanCommand(
  deps: ScanDeps,
  options: ScanCommandOptions,
): Promise<{ code: number; output: string; report: ScanReport }> {
  const report = await runScan(deps, {
    trigger: 'cli',
    dryRun: options.dryRun,
    ignoreSchedule: true,
    ...(options.productId ? { productId: options.productId } : {}),
  });
  return {
    code: report.status === 'failed' ? 1 : 0,
    output: formatScanReport(report, options),
    report,
  };
}
