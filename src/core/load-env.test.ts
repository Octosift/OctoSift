import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from './load-env';

const ROOT = resolve(process.cwd(), '.tmp');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(files: Record<string, string>): string {
  mkdirSync(ROOT, { recursive: true });
  const dir = mkdtempSync(join(ROOT, 'env-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe('loading .env files', () => {
  it('fills in variables from .env.local, then .env, without overriding the environment', () => {
    const dir = folder({
      '.env.local': 'EXPERIMENTAL_CLI_PROVIDERS=1\nLOG_LEVEL=debug\n',
      '.env': '# settings\nLOG_LEVEL=warn\nDATABASE_PATH="data/other.sqlite"\nPORT=3005\n',
    });
    const env: Record<string, string | undefined> = { PORT: '4000' };
    expect(loadDotEnv(env, dir)).toEqual(['.env.local', '.env']);
    expect(env).toEqual({
      PORT: '4000',
      EXPERIMENTAL_CLI_PROVIDERS: '1',
      LOG_LEVEL: 'debug',
      DATABASE_PATH: 'data/other.sqlite',
    });
  });

  it('does nothing without the files', () => {
    const env: Record<string, string | undefined> = {};
    expect(loadDotEnv(env, folder({}))).toEqual([]);
    expect(env).toEqual({});
  });
});
