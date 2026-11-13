/**
 * `eval`: measures triage and qualify on the golden set with the models in
 * Settings. It spends real money, so it refuses to start without
 * --yes-spend and stops at --max-cost.
 */
import { parseArgs } from 'node:util';
import { createAiClient, type ModelResolution } from '../core/ai/client';
import type { AiStage, Generator } from '../core/ai/types';
import { createUsageLedger } from '../core/ai/usage';
import type { Clock } from '../core/clock';
import type { Db } from '../core/db/client';
import { SAMPLE_PRODUCT_SLUGS, type SampleProductSlug } from '../core/demo/sample-products';
import { CONFUSION_COLUMNS, type EvalCase, type Rate } from '../core/eval/metrics';
import { evaluablePosts, runEvaluation, type EvalReport } from '../core/eval/run-eval';
import type { Logger } from '../core/log';
import type { SettingsStore } from '../core/settings/store';

export const EVAL_USAGE =
  'Usage: pnpm eval --yes-spend [--max-cost <usd>] [--product <sample product>] [--json]';

export interface EvalCommandOptions {
  yesSpend: boolean;
  maxCost: number;
  products: SampleProductSlug[];
  json: boolean;
}

export function parseEvalArgs(
  argv: string[],
): { ok: true; options: EvalCommandOptions } | { ok: false; message: string } {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        'yes-spend': { type: 'boolean', default: false },
        'max-cost': { type: 'string', default: '1' },
        product: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    const maxCost = Number(values['max-cost']);
    if (!Number.isFinite(maxCost) || maxCost <= 0) {
      return {
        ok: false,
        message: `--max-cost must be a positive number of dollars.\n${EVAL_USAGE}`,
      };
    }
    const product = values.product;
    if (product !== undefined && !(SAMPLE_PRODUCT_SLUGS as readonly string[]).includes(product)) {
      return {
        ok: false,
        message: `--product must be one of ${SAMPLE_PRODUCT_SLUGS.join(', ')}.\n${EVAL_USAGE}`,
      };
    }
    return {
      ok: true,
      options: {
        yesSpend: values['yes-spend'],
        maxCost,
        products: product ? [product as SampleProductSlug] : [...SAMPLE_PRODUCT_SLUGS],
        json: values.json,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: `${error instanceof Error ? error.message : 'Invalid arguments'}\n${EVAL_USAGE}`,
    };
  }
}

const percent = (rate: Rate) =>
  rate.value === null
    ? '–'
    : `${(rate.value * 100).toFixed(1)}% (${rate.numerator}/${rate.denominator})`;

function missLine(item: EvalCase): string {
  const expected = `${item.label.fit} ${item.label.score[0]}-${item.label.score[1]}`;
  const got = item.fit === null ? 'not qualified' : `${item.fit} ${item.score ?? '–'}`;
  return `  ${item.id}  expected ${expected}, got ${got}: ${item.title}\n      ${item.reason}`;
}

export function formatEvalReport(report: EvalReport): string {
  const lines = [
    `Posts evaluated: ${report.cases.length}${report.stoppedForBudget ? ' (stopped at the cost cap)' : ''}`,
    `Errors: ${report.errors}`,
    '',
    `Triage  precision ${percent(report.triage.precision)}  recall ${percent(report.triage.recall)}`,
    `Leads   precision ${percent(report.leads.precision)}  recall ${percent(report.leads.recall)}`,
    '',
    'Confusion by fit (rows: expected, columns: got)',
    `  ${''.padEnd(9)}${CONFUSION_COLUMNS.map((column) => column.padStart(15)).join('')}`,
    ...(['direct', 'soft', 'none'] as const).map(
      (fit) =>
        `  ${fit.padEnd(9)}${CONFUSION_COLUMNS.map((column) => String(report.confusion[fit][column]).padStart(15)).join('')}`,
    ),
    '',
    `Cost: $${report.costUsd.toFixed(4)}${report.costIncomplete ? ' (some prices unknown)' : ''}, ` +
      `per post: ${report.costPerPost === null ? '–' : `$${report.costPerPost.toFixed(5)}`}`,
    '',
    report.worst.length === 0 ? 'No misses.' : 'Worst misses:',
    ...report.worst.map(missLine),
  ];
  return `${lines.join('\n')}\n`;
}

export interface EvalDeps {
  db: Db;
  generator: Generator;
  resolveModel: (stage: AiStage) => ModelResolution;
  settings: SettingsStore;
  clock: Clock;
  log: Logger;
  redact: (text: string) => string;
}

export function describePlan(deps: EvalDeps, options: EvalCommandOptions): string {
  const posts = options.products.reduce((total, slug) => total + evaluablePosts(slug).length, 0);
  const model = (stage: AiStage) => {
    const resolution = deps.resolveModel(stage);
    return resolution.ok
      ? `${resolution.model.provider}/${resolution.model.model}`
      : `not ready (${resolution.message})`;
  };
  return [
    `This evaluation sends ${posts} golden posts to triage (${model('triage')})`,
    `and the relevant ones to qualify (${model('qualify')}), stopping at $${options.maxCost.toFixed(2)}.`,
    'Run it again with --yes-spend to start.',
    '',
  ].join('\n');
}

export async function runEvalCommand(
  deps: EvalDeps,
  options: EvalCommandOptions,
): Promise<{ code: number; output: string }> {
  if (!options.yesSpend) return { code: 2, output: describePlan(deps, options) };
  const ledger = createUsageLedger({
    db: deps.db,
    clock: deps.clock,
    runId: null,
    prices: () => deps.settings.get('ai.prices'),
    caps: () => ({ perRunUsd: options.maxCost, perDayUsd: Number.POSITIVE_INFINITY }),
  });
  const ai = createAiClient({
    generator: deps.generator,
    resolveModel: deps.resolveModel,
    usage: ledger,
    redact: deps.redact,
    log: deps.log,
  });
  const report = await runEvaluation({
    ai,
    products: options.products,
    clock: deps.clock,
    showThreshold: deps.settings.get('thresholds').show,
    spend: () => {
      const summary = ledger.summary();
      return { costUsd: summary.costUsd, incomplete: summary.incomplete };
    },
  });
  const output = options.json ? `${JSON.stringify(report, null, 2)}\n` : formatEvalReport(report);
  return {
    code: report.errors > 0 && report.cases.every((item) => item.fit === null) ? 1 : 0,
    output,
  };
}
