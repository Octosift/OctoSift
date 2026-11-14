/**
 * Worker entry point: runs scans on a schedule and on request until it is
 * stopped with SIGINT or SIGTERM.
 */
import { hostname } from 'node:os';
import { demoRuntimeOverrides } from '../core/demo/runtime';
import { parseEnv } from '../core/env';
import { createRuntime } from '../core/runtime';
import { createScheduler } from './scheduler';

const parsedEnv = parseEnv(process.env);
if (!parsedEnv.ok) {
  process.stderr.write(`Invalid environment:\n${parsedEnv.errors.join('\n')}\n`);
  process.exit(2);
}

const runtime = createRuntime({
  env: parsedEnv.env,
  rawEnv: process.env,
  ...(parsedEnv.env.DEMO_MODE ? { overrides: demoRuntimeOverrides() } : {}),
});
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    controller.abort();
  });
}

const scheduler = createScheduler({
  db: runtime.db,
  settings: runtime.settings,
  clock: runtime.clock,
  log: runtime.log,
  scanDeps: () => runtime.scanDeps(),
  serp: () => runtime.serp(),
  checkReplies: () => runtime.checkReplies(),
  owner: `worker-${hostname()}-${process.pid}`,
});

scheduler
  .run(controller.signal)
  .catch((error: unknown) => {
    runtime.log.error('Worker crashed', { error });
    process.exitCode = 1;
  })
  .finally(() => {
    runtime.close();
  });
