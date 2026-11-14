import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeGenerator } from './ai/fake';
import type { LogRecord } from './log';
import type { SourceChain } from './reddit/chain';
import { createRuntime } from './runtime';
import { writeState } from './state';
import { createFakeClock } from './testing/fake-clock';
import { FAKE_KEYS } from './testing/fake-secrets';

const TMP_ROOT = resolve(import.meta.dirname, '../../.tmp');
const dirs: string[] = [];

function databasePath(): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, 'runtime-'));
  dirs.push(dir);
  return relative(process.cwd(), join(dir, 'app.sqlite'));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const env = (path: string) => ({
  DATABASE_PATH: path,
  LOG_LEVEL: 'info' as const,
  PUBLIC_URL: 'http://127.0.0.1:3000',
  DEMO_MODE: false,
  EXPERIMENTAL_CLI_PROVIDERS: false,
});

describe('createRuntime', () => {
  it('creates the database and a private key file next to it', () => {
    const path = databasePath();
    const runtime = createRuntime({ env: env(path), rawEnv: {} });
    runtime.close();
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(path, '..', '.secret'))).toBe(true);
  });

  it('redacts provider keys supplied through the environment from logs', () => {
    const records: LogRecord[] = [];
    const runtime = createRuntime({
      env: env(databasePath()),
      rawEnv: { OPENAI_API_KEY: 'plain-env-provider-key' },
      logSink: (record) => records.push(record),
    });
    runtime.log.error('request failed with plain-env-provider-key');
    runtime.close();
    expect(JSON.stringify(records)).not.toContain('plain-env-provider-key');
  });

  it('builds scan dependencies from settings and secrets', () => {
    const runtime = createRuntime({ env: env(databasePath()), rawEnv: {} });
    runtime.settings.set('ai.stages', {
      triage: { provider: 'openai', model: 'small' },
      qualify: null,
      draft: null,
      review: null,
    });
    expect(runtime.resolveModel('triage')).toMatchObject({ ok: false, kind: 'missing_key' });
    runtime.secrets.set('openai_api_key', FAKE_KEYS.openAi);
    expect(runtime.resolveModel('triage')).toMatchObject({ ok: true });
    expect(runtime.scanDeps().settings).toBe(runtime.settings);
    runtime.close();
  });

  it('offers evergreen checks only once both DataForSEO credentials are set', () => {
    const runtime = createRuntime({ env: env(databasePath()), rawEnv: {} });
    expect(runtime.serp()).toBeNull();
    runtime.secrets.set('dataforseo_login', 'demo@example.com');
    expect(runtime.serp()).toBeNull();
    runtime.secrets.set('dataforseo_password', 'not-a-real-password');
    expect(runtime.serp()).toBeTypeOf('function');
    runtime.close();
  });

  it('reads through the preferred source when it is set up, and otherwise through RSS', () => {
    const runtime = createRuntime({ env: env(databasePath()), rawEnv: {} });
    const active = () => (runtime.scanDeps().source as SourceChain).active();
    expect(active()).toBe('rss');
    runtime.secrets.set('reddit_session_cookie', 'reddit_session=synthetic-session-value');
    expect(active()).toBe('session');
    runtime.settings.set('reddit.source', 'rss');
    expect(active()).toBe('rss');
    runtime.close();
  });

  it('keeps Reddit reads paused after a restart', async () => {
    const path = databasePath();
    const clock = createFakeClock();
    const first = createRuntime({ env: env(path), rawEnv: {}, clock });
    writeState(first.db, 'state.redditPausedUntil', Math.floor(clock.nowMs() / 1000) + 600);
    first.close();
    const second = createRuntime({ env: env(path), rawEnv: {}, clock });
    const result = await second.source.fetchNewPosts(['freelance_demo'], { limit: 10 });
    second.close();
    expect(result).toMatchObject({ ok: false, kind: 'blocked' });
  });

  it('uses the replacements given for demo mode', async () => {
    const generator = createFakeGenerator(() => ({ output: 'OK' }));
    const runtime = createRuntime({
      env: env(databasePath()),
      rawEnv: {},
      overrides: {
        generator,
        resolveModel: () => ({
          ok: true,
          model: { provider: 'openai_compatible', model: 'fake' },
          credentials: { apiKey: '', baseUrl: null },
        }),
      },
    });
    const result = await runtime.ai().text({ task: 'test', system: 's', prompt: 'p' });
    runtime.close();
    expect(result).toMatchObject({ ok: true, value: 'OK' });
  });
});
