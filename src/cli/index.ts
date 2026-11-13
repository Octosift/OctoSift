/**
 * Command-line entry point: `scan` and `eval`.
 * Output goes to stdout; logs go to stderr so `--json` output stays clean.
 */
import { BRAND } from '../core/brand';
import { demoRuntimeOverrides } from '../core/demo/runtime';
import { parseEnv } from '../core/env';
import { createRuntime, type Runtime } from '../core/runtime';
import { createRedactor } from '../core/secrets/redact';
import { EVAL_USAGE, parseEvalArgs, runEvalCommand } from './eval';
import { parseScanArgs, runScanCommand, SCAN_USAGE } from './scan';

function stderrSink(record: { level: string; message: string; fields: object }): void {
  const fields = Object.keys(record.fields).length > 0 ? ` ${JSON.stringify(record.fields)}` : '';
  process.stderr.write(`${record.level.toUpperCase()} ${record.message}${fields}\n`);
}

function usageError(message: string): number {
  process.stderr.write(`${message}\n`);
  return 2;
}

async function withRuntime(
  run: (runtime: Runtime) => Promise<{ code: number; output: string }>,
): Promise<number> {
  const parsedEnv = parseEnv(process.env);
  if (!parsedEnv.ok) return usageError(`Invalid environment:\n${parsedEnv.errors.join('\n')}`);
  const runtime = createRuntime({
    env: parsedEnv.env,
    rawEnv: process.env,
    logSink: stderrSink,
    ...(parsedEnv.env.DEMO_MODE ? { overrides: demoRuntimeOverrides() } : {}),
  });
  try {
    const result = await run(runtime);
    process.stdout.write(result.output);
    return result.code;
  } finally {
    runtime.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'scan') {
    const parsed = parseScanArgs(rest);
    if (!parsed.ok) return usageError(parsed.message);
    return withRuntime((runtime) => runScanCommand(runtime.scanDeps(), parsed.options));
  }
  if (command === 'eval') {
    const parsed = parseEvalArgs(rest);
    if (!parsed.ok) return usageError(parsed.message);
    return withRuntime((runtime) =>
      runEvalCommand(
        {
          db: runtime.db,
          generator: runtime.generator,
          resolveModel: runtime.resolveModel,
          settings: runtime.settings,
          clock: runtime.clock,
          log: runtime.log,
          redact: runtime.redactor.redact,
        },
        parsed.options,
      ),
    );
  }
  process.stdout.write(`${BRAND.name} command line\n\n${SCAN_USAGE}\n${EVAL_USAGE}\n`);
  return command === undefined || command === 'help' ? 0 : 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unexpected error: ${createRedactor().redact(message)}\n`);
    process.exitCode = 1;
  },
);
