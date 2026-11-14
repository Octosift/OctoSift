/**
 * The dashboard gets `.env.local` and `.env` from Next.js; the worker, the
 * CLI and the scripts load them here, so every process sees the same
 * settings. As in Next.js, a variable already set in the environment wins.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export function loadDotEnv(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): string[] {
  const loaded: string[] = [];
  for (const name of ['.env.local', '.env']) {
    const path = resolve(cwd, name);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
      env[key] ??= value;
    }
    loaded.push(name);
  }
  return loaded;
}
