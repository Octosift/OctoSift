/**
 * Command-line entry point: `scan` (more commands are added alongside).
 * Output goes to stdout; logs go to stderr so `--json` output stays clean.
 */
import { BRAND } from '../core/brand';
import { demoRuntimeOverrides } from '../core/demo/runtime';
import { parseEnv } from '../core/env';
import { createRedactor } from '../core/secrets/redact';
import { createRuntime } from '../core/runtime';
import { parseScanArgs, runScanCommand, SCAN_USAGE } from './scan';

function stderrSink(record: { level: string; message: string; fields: object }): void {
  const fields = Object.keys(record.fields).length > 0 ? ` ${JSON.stringify(record.fields)}` : '';
  process.stderr.write(`${record.level.toUpperCase()} ${record.message}${fields}\n`);
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'scan') {
    process.stdout.write(`${BRAND.name} command line\n\n${SCAN_USAGE}\n`);
    return command === undefined || command === 'help' ? 0 : 2;
  }
  const parsedArgs = parseScanArgs(rest);
  if (!parsedArgs.ok) {
    process.stderr.write(`${parsedArgs.message}\n`);
    return 2;
  }
  const parsedEnv = parseEnv(process.env);
  if (!parsedEnv.ok) {
    process.stderr.write(`Invalid environment:\n${parsedEnv.errors.join('\n')}\n`);
    return 2;
  }
  const runtime = createRuntime({
    env: parsedEnv.env,
    rawEnv: process.env,
    logSink: stderrSink,
    ...(parsedEnv.env.DEMO_MODE ? { overrides: demoRuntimeOverrides() } : {}),
  });
  try {
    const result = await runScanCommand(runtime.scanDeps(), parsedArgs.options);
    process.stdout.write(result.output);
    return result.code;
  } finally {
    runtime.close();
  }
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
