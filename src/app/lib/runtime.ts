/**
 * The dashboard's access to the core runtime. One runtime (and so one
 * database connection) per server process, kept on globalThis so that
 * development reloads do not open a new connection on every edit.
 */
import 'server-only';
import { parseEnv } from '@/core/env';
import { createRuntime, type Runtime } from '@/core/runtime';
import { demoRuntimeOverrides } from '@/core/demo/runtime';

const holder = globalThis as typeof globalThis & { dashboardRuntime?: Runtime };

export function getRuntime(): Runtime {
  if (!holder.dashboardRuntime) {
    const parsed = parseEnv(process.env);
    if (!parsed.ok) throw new Error(`Invalid environment: ${parsed.errors.join('; ')}`);
    holder.dashboardRuntime = createRuntime({
      env: parsed.env,
      rawEnv: process.env,
      ...(parsed.env.DEMO_MODE ? { overrides: demoRuntimeOverrides() } : {}),
    });
  }
  return holder.dashboardRuntime;
}

export function nowSeconds(): number {
  return Math.floor(getRuntime().clock.nowMs() / 1000);
}
