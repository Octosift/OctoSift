import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  checkCodexLogin,
  childEnv,
  createCodexGenerator,
  findCodexBin,
  MACOS_APP_CODEX,
  strictSchema,
  summarizeOutput,
  type ChildLike,
  type SpawnLike,
} from './codex';
import { profileWire, qualifyWire, reviewWire, triageWire, draftWire } from './schemas';
import type { GenerateRequest } from './types';

const TEMP = resolve(process.cwd(), '.tmp/codex-test');
const fixture = (name: string) =>
  readFileSync(resolve(process.cwd(), 'fixtures/codex', name), 'utf8');

afterEach(async () => {
  await rm(TEMP, { recursive: true, force: true });
});

interface Script {
  stdout?: string;
  stderr?: string;
  code?: number;
  /** Written to the -o file before exit; null writes nothing. */
  answer?: string | null;
  /** Never exits on its own. */
  hang?: boolean;
  spawnError?: NodeJS.ErrnoException;
}

/** A fake CLI: records each call and plays back a script. */
function fakeCodex(scripts: Script[]) {
  const calls: {
    args: string[];
    env: Record<string, string>;
    stdio: string[];
    schema: unknown;
    workEmpty: boolean;
  }[] = [];
  let active = 0;
  let maxActive = 0;
  const killed: string[] = [];
  const spawn: SpawnLike = (_command, args, options) => {
    const script = scripts.shift() ?? {};
    if (script.spawnError) throw script.spawnError;
    const list = [...args];
    const schemaAt = list.indexOf('--output-schema');
    const work = list.includes('-C') ? (list[list.indexOf('-C') + 1] ?? '') : '';
    calls.push({
      args: list,
      env: options.env,
      stdio: [...options.stdio],
      schema:
        schemaAt >= 0
          ? (JSON.parse(readFileSync(list[schemaAt + 1] ?? '', 'utf8')) as unknown)
          : null,
      workEmpty: work !== '' && readdirSync(work).length === 0,
    });
    active += 1;
    maxActive = Math.max(maxActive, active);
    const child = new EventEmitter() as EventEmitter & ChildLike;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    Object.assign(child, {
      stdout,
      stderr,
      kill: (signal?: string) => {
        killed.push(signal ?? 'SIGTERM');
        active -= 1;
        setImmediate(() => child.emit('close', null));
        return true;
      },
    });
    if (!script.hang) {
      setTimeout(() => {
        const out = list[list.indexOf('-o') + 1];
        if (out && script.answer !== null && script.answer !== undefined) {
          writeFileSync(out, script.answer);
        }
        stdout.end(script.stdout ?? '');
        stderr.end(script.stderr ?? '');
        active -= 1;
        child.emit('close', script.code ?? 0);
      }, 5);
    }
    return child;
  };
  return { spawn, calls, killed, maxActive: () => maxActive };
}

async function generator(scripts: Script[], timeoutMs = 2_000) {
  await mkdir(TEMP, { recursive: true });
  const fake = fakeCodex(scripts);
  const generate = createCodexGenerator({
    bin: () => '/opt/codex/bin/codex',
    env: { PATH: '/usr/bin', HOME: '/var/demo', OPENAI_API_KEY: 'should-not-pass' },
    effort: (request) => (request.task === 'triage' ? 'low' : 'medium'),
    redact: (text) => text,
    spawn: fake.spawn,
    timeoutMs,
    tempRoot: TEMP,
  });
  return { generate, ...fake };
}

const request = (overrides: Partial<GenerateRequest> = {}): GenerateRequest => ({
  task: 'triage',
  model: { provider: 'openai', model: 'gpt-6-luna' },
  credentials: { apiKey: '', baseUrl: null },
  system: 'You screen synthetic posts.',
  prompt: '<post id="t3_cdx001">Title: Chasing late invoices</post>',
  schema: triageWire,
  maxOutputTokens: 500,
  timeoutMs: 1_000,
  subject: {},
  ...overrides,
});

const ANSWER = JSON.stringify({
  results: [
    { id: 't3_cdx001', relevant: true, why: 'Asks how to chase late invoices' },
    { id: 't3_cdx002', relevant: false, why: 'A meme about coffee' },
  ],
});

describe('codex generator', () => {
  it('runs codex exec with the verified flags in an empty folder, with stdin closed', async () => {
    const { generate, calls } = await generator([
      { stdout: fixture('triage-ok.jsonl'), answer: ANSWER },
    ]);
    const response = await generate(request());
    expect(response).toEqual({
      ok: true,
      output: JSON.parse(ANSWER) as unknown,
      usage: { inputTokens: 18_942, cachedInputTokens: 17_920, outputTokens: 212 },
    });
    const [call] = calls;
    expect(call?.args.slice(0, 7)).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ignore-rules',
      '-s',
    ]);
    expect(call?.args).toEqual(
      expect.arrayContaining(['read-only', '-c', 'model_reasoning_effort=low', '-m', 'gpt-6-luna']),
    );
    expect(call?.args.at(-1)).toBe(
      'You screen synthetic posts.\n\n<post id="t3_cdx001">Title: Chasing late invoices</post>',
    );
    expect(call?.workEmpty).toBe(true);
    expect(call?.stdio[0]).toBe('ignore');
    expect(call?.env).toEqual({ PATH: '/usr/bin', HOME: '/var/demo' });
    expect(call?.schema).toEqual(strictSchema(triageWire));
  });

  it('returns plain text when no schema is asked for', async () => {
    const { generate, calls } = await generator([
      { stdout: fixture('text-ok.jsonl'), answer: 'OK\n' },
    ]);
    const response = await generate(request({ schema: null, task: 'test' }));
    expect(response).toMatchObject({ ok: true, output: 'OK' });
    expect(calls[0]?.args).not.toContain('--output-schema');
    expect(calls[0]?.args).toContain('model_reasoning_effort=medium');
  });

  it('cleans up its temporary folders', async () => {
    const { generate } = await generator([{ stdout: fixture('triage-ok.jsonl'), answer: ANSWER }]);
    await generate(request());
    expect(readdirSync(TEMP)).toEqual([]);
  });

  it('never repeats stderr: a failure carries a scrubbed one-line summary', async () => {
    const { generate } = await generator([
      {
        code: 2,
        stderr:
          'error: could not load /var/demo/settings.toml from https://server.example.test/events\nsecond line',
      },
    ]);
    const response = await generate(request());
    expect(response).toMatchObject({ ok: false, kind: 'provider_error' });
    const message = response.ok ? '' : response.message;
    expect(message).toBe('Codex exited with code 2: error: could not load [path] from [address].');
    expect(message).not.toContain('settings.toml');
    expect(message).not.toContain('second line');
  });

  it('says how to sign in when Codex is not logged in', async () => {
    const { generate } = await generator([{ code: 1, stderr: 'Error: Not logged in' }]);
    expect(await generate(request())).toMatchObject({
      ok: false,
      message: 'Codex is not signed in. Run `codex login` in a terminal, then try again.',
    });
  });

  it('reports a failed turn and an answer that is not JSON as retryable failures', async () => {
    const { generate } = await generator([
      { stdout: fixture('turn-failed.jsonl'), answer: null },
      { stdout: fixture('triage-ok.jsonl'), answer: 'not json' },
      { stdout: fixture('triage-ok.jsonl'), answer: null },
    ]);
    expect(await generate(request())).toMatchObject({
      ok: false,
      kind: 'provider_error',
      message: 'Codex reported a failure: stream disconnected before completion',
    });
    expect(await generate(request())).toMatchObject({ ok: false, kind: 'invalid_output' });
    expect(await generate(request())).toMatchObject({ ok: false, kind: 'invalid_output' });
  });

  it('kills a call that runs past the timeout', async () => {
    const { generate, killed } = await generator([{ hang: true }], 50);
    expect(await generate(request())).toMatchObject({
      ok: false,
      message: 'Codex did not answer within 180 seconds.',
    });
    expect(killed).toContain('SIGTERM');
  });

  it('explains a missing binary', async () => {
    const missing = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    const { generate } = await generator([{ spawnError: missing }]);
    expect(await generate(request())).toMatchObject({
      ok: false,
      message: 'The Codex CLI was not found. Install it, or set CODEX_BIN to its path.',
    });
  });

  it('runs one call at a time', async () => {
    const { generate, maxActive } = await generator([
      { stdout: fixture('triage-ok.jsonl'), answer: ANSWER },
      { stdout: fixture('triage-ok.jsonl'), answer: ANSWER },
      { stdout: fixture('triage-ok.jsonl'), answer: ANSWER },
    ]);
    const results = await Promise.all([
      generate(request()),
      generate(request()),
      generate(request()),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(maxActive()).toBe(1);
  });
});

describe('codex helpers', () => {
  it('finds the CLI through CODEX_BIN, PATH or the ChatGPT app', () => {
    const exists = (paths: string[]) => (path: string) => paths.includes(path);
    expect(findCodexBin({ CODEX_BIN: '/opt/codex' }, exists(['/opt/codex']))).toBe('/opt/codex');
    expect(findCodexBin({ CODEX_BIN: '/opt/missing' }, exists([]))).toBeNull();
    expect(
      findCodexBin({ PATH: '/usr/bin:/opt/tools' }, exists([join('/opt/tools', 'codex')])),
    ).toBe(join('/opt/tools', 'codex'));
    expect(findCodexBin({ PATH: '/usr/bin' }, exists([MACOS_APP_CODEX]))).toBe(MACOS_APP_CODEX);
    expect(findCodexBin({}, exists([]))).toBeNull();
  });

  it('passes no keys to the CLI', () => {
    expect(
      childEnv({
        PATH: '/bin',
        HOME: '/h',
        ANTHROPIC_API_KEY: 'x',
        APP_SECRET: 'y',
        CODEX_HOME: '/c',
      }),
    ).toEqual({ PATH: '/bin', HOME: '/h', CODEX_HOME: '/c' });
  });

  it('scrubs paths, addresses and long tokens from summaries', () => {
    const redact = (text: string) => text.replace('hunter2', '[redacted]');
    expect(
      summarizeOutput(
        '\u001b[31mfailed\u001b[0m reading ~/.codex/auth.json for demo@example.com token abcdefghijklmnopqrstuvwxyz0123456789 hunter2',
        redact,
      ),
    ).toBe('failed reading [path] for [email] token [redacted] [redacted]');
    expect(summarizeOutput('word '.repeat(60), redact)).toHaveLength(120);
  });

  it.each([
    ['triage', triageWire],
    ['qualify', qualifyWire],
    ['draft', draftWire],
    ['review', reviewWire],
    ['profile', profileWire],
  ])('turns the %s schema into a strict one', (_, schema: z.ZodType) => {
    const strict = strictSchema(schema);
    expect(strict.$schema).toBeUndefined();
    const objects: Record<string, unknown>[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (typeof node === 'object' && node !== null) {
        const record = node as Record<string, unknown>;
        if (record.type === 'object') objects.push(record);
        Object.values(record).forEach(walk);
      }
    };
    walk(strict);
    expect(objects.length).toBeGreaterThan(0);
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
      expect(object.required).toEqual(Object.keys(object.properties as object));
    }
  });
});

describe('codex login check', () => {
  const login = async (script: Script, bin: string | null = '/opt/codex/bin/codex') => {
    const fake = fakeCodex([script]);
    return checkCodexLogin({ bin, env: {}, redact: (text) => text, spawn: fake.spawn });
  };

  it('recognises a ChatGPT sign-in and an API key sign-in', async () => {
    expect(await login({ stdout: 'Logged in using ChatGPT\n' })).toEqual({
      ok: true,
      method: 'chatgpt',
      message: 'Signed in with ChatGPT.',
    });
    expect(await login({ stderr: 'Logged in using an API key - sk-***\n' })).toMatchObject({
      ok: true,
      method: 'api_key',
    });
  });

  it('gives the fix when Codex is missing or signed out', async () => {
    expect(await login({}, null)).toMatchObject({ ok: false });
    expect(await login({ code: 1, stdout: 'Not logged in\n' })).toEqual({
      ok: false,
      message: 'Codex is not signed in. Run `codex login` in a terminal, then check again.',
    });
  });
});
