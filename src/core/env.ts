/**
 * Environment variables, validated once at start-up.
 *
 * Only entry points (worker, CLI, dashboard) read `process.env`; they pass
 * the result of `parseEnv` down. Provider keys are not listed here: the
 * secret store receives the raw environment and looks them up by name.
 */
import { z } from 'zod';
import { formatIssues } from './settings/store';

const flag = z
  .enum(['1', '0', 'true', 'false', 'yes', 'no', ''])
  .optional()
  .transform((value) => value === '1' || value === 'true' || value === 'yes');

const envSchema = z.object({
  DATABASE_PATH: z.string().min(1).default('data/app.sqlite'),
  APP_SECRET: z.string().optional(),
  APP_PASSWORD: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Where the dashboard is reached, used for links in notifications. */
  PUBLIC_URL: z.url().default('http://127.0.0.1:3005'),
  DEMO_MODE: flag,
  /** Offers providers that run a local CLI on the user's own subscription. Experimental. */
  EXPERIMENTAL_CLI_PROVIDERS: flag,
  /** The Codex CLI, when it is not on PATH or in the ChatGPT app. */
  CODEX_BIN: z.string().optional(),
  /** On unless set to 0, false or no: the daily check for a new release on GitHub. */
  UPDATE_CHECK: z
    .enum(['1', '0', 'true', 'false', 'yes', 'no'])
    .optional()
    .transform(
      (value) => value === undefined || value === '1' || value === 'true' || value === 'yes',
    ),
});

export type AppEnv = z.output<typeof envSchema>;

export type EnvResult = { ok: true; env: AppEnv } | { ok: false; errors: string[] };

export function parseEnv(raw: Readonly<Record<string, string | undefined>>): EnvResult {
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  return parsed.success
    ? { ok: true, env: parsed.data }
    : { ok: false, errors: formatIssues(parsed.error) };
}
