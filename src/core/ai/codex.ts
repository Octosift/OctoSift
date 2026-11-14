/**
 * An experimental provider that runs prompts through the Codex CLI, so the
 * pipeline can run on a ChatGPT sign-in instead of an API key.
 *
 * Each call runs `codex exec` once, non-interactively, in an empty temporary
 * folder, with the user's own Codex config, rules and instruction files
 * ignored, a read-only sandbox, stdin closed and a minimal environment (no
 * API keys). The JSON schema of the expected answer goes in a file, the
 * answer comes back in another, and the token usage is read from the JSONL
 * event stream. Calls run one at a time and are killed after a timeout.
 *
 * Codex's stderr can hold private config, server addresses and paths, so it
 * is never logged or returned as is: failures carry a short, scrubbed
 * one-line summary.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { CONFIG } from '../config';
import type { AiUsage, GenerateRequest, GenerateResponse, Generator } from './types';

/** Where the ChatGPT desktop app keeps its copy of the CLI on macOS. */
export const MACOS_APP_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';

export type CodexEffort = 'low' | 'medium' | 'high';

/** The part of a child process the runner uses, so tests can provide a fake. */
export interface ChildLike {
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { env: Record<string, string>; stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildLike;

/** Finds the CLI: CODEX_BIN, then PATH, then the copy inside the ChatGPT app. */
export function findCodexBin(
  env: Readonly<Record<string, string | undefined>>,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const explicit = env.CODEX_BIN?.trim();
  if (explicit) return exists(explicit) ? explicit : null;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir && exists(join(dir, 'codex'))) return join(dir, 'codex');
  }
  return exists(MACOS_APP_CODEX) ? MACOS_APP_CODEX : null;
}

/** Only what Codex needs to find its sign-in and run; never API keys. */
export function childEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const keep = ['PATH', 'HOME', 'CODEX_HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME'];
  return Object.fromEntries(
    keep.flatMap((name) => {
      const value = env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

/**
 * A one-line, scrubbed summary of CLI output for logs and messages: no paths,
 * addresses, e-mail addresses or anything key-shaped, and short.
 */
export function summarizeOutput(text: string, redact: (text: string) => string): string {
  const line =
    text
      // Colour codes, which the CLI adds on terminals.
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? '';
  const scrubbed = redact(line)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[address]')
    .replace(/\S+@\S+\.\S+/g, '[email]')
    .replace(/(^|\s)(~|\.{0,2})?\/\S+/g, '$1[path]')
    .replace(/\b[A-Za-z]:\\\S+/g, '[path]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');
  return scrubbed.length > 120 ? `${scrubbed.slice(0, 119)}…` : scrubbed;
}

type JsonSchema = Record<string, unknown>;

/**
 * The schema in the form structured output accepts: every object closed and
 * every property required. The wire schemas already have only required
 * fields; this makes sure of it and drops the `$schema` marker.
 */
export function strictSchema(schema: z.ZodType): JsonSchema {
  function walk(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== 'object' || node === null) return node;
    const entries = Object.entries(node).filter(([key]) => key !== '$schema');
    const result: JsonSchema = Object.fromEntries(
      entries.map(([key, value]) => [key, walk(value)]),
    );
    if (result.type === 'object' && typeof result.properties === 'object' && result.properties) {
      result.required = Object.keys(result.properties);
      result.additionalProperties = false;
    }
    return result;
  }
  return walk(z.toJSONSchema(schema, { io: 'output' })) as JsonSchema;
}

const usageEvent = z.object({
  type: z.literal('turn.completed'),
  usage: z.object({
    input_tokens: z.number(),
    cached_input_tokens: z.number().default(0),
    output_tokens: z.number(),
    reasoning_output_tokens: z.number().default(0),
  }),
});

const failureEvent = z.object({
  type: z.enum(['turn.failed', 'error']),
  error: z.object({ message: z.string() }).optional(),
  message: z.string().optional(),
});

/** Token usage and any failure reported in the JSONL event stream. */
export function readEvents(jsonl: string): { usage: AiUsage | null; failure: string | null } {
  let usage: AiUsage | null = null;
  let failure: string | null = null;
  for (const line of jsonl.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      // A partial line, for example when the process was killed.
      continue;
    }
    const completed = usageEvent.safeParse(event);
    if (completed.success) {
      const used = completed.data.usage;
      // Cached input is part of the input count, and reasoning is part of the output count.
      usage = {
        inputTokens: used.input_tokens,
        cachedInputTokens: used.cached_input_tokens,
        outputTokens: used.output_tokens,
      };
      continue;
    }
    const failed = failureEvent.safeParse(event);
    if (failed.success) failure = failed.data.error?.message ?? failed.data.message ?? 'failed';
  }
  return { usage, failure };
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: NodeJS.ErrnoException | null;
}

function collect(stream: Readable | null, into: string[]): void {
  stream?.setEncoding('utf8');
  stream?.on('data', (chunk: string) => {
    into.push(chunk);
  });
}

/** Runs the CLI once and waits for it to exit, killing it after the timeout. */
export function runCodex(
  spawn: SpawnLike,
  bin: string,
  args: readonly string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let timedOut = false;
    let settled = false;
    const pending: { timer?: NodeJS.Timeout } = {};
    const finish = (code: number | null, spawnError: NodeJS.ErrnoException | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(pending.timer);
      resolve({ code, stdout: stdout.join(''), stderr: stderr.join(''), timedOut, spawnError });
    };
    let child: ChildLike;
    try {
      child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      finish(null, error as NodeJS.ErrnoException);
      return;
    }
    pending.timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // A process that ignores SIGTERM is stopped for good shortly after.
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);
    collect(child.stdout, stdout);
    collect(child.stderr, stderr);
    child.on('error', (error) => {
      finish(null, error);
    });
    child.on('close', (code) => {
      finish(code, null);
    });
  });
}

/** Turns a failed run into the message the user sees, with the fix when there is one. */
export function describeFailure(run: RunResult, redact: (text: string) => string): string {
  if (run.spawnError?.code === 'ENOENT') {
    return 'The Codex CLI was not found. Install it, or set CODEX_BIN to its path.';
  }
  if (run.spawnError) return 'The Codex CLI could not be started.';
  if (run.timedOut) {
    return `Codex did not answer within ${String(CONFIG.ai.cliTimeoutMs / 1000)} seconds.`;
  }
  const output = `${run.stderr}\n${run.stdout}`;
  if (/not logged in|log ?in required|please (log|sign) in|unauthori[sz]ed/i.test(output)) {
    return 'Codex is not signed in. Run `codex login` in a terminal, then try again.';
  }
  if (/usage limit|rate limit|too many requests/i.test(output)) {
    return 'Codex reports that the usage limit of the subscription is reached. Try again later.';
  }
  const summary = summarizeOutput(run.stderr || run.stdout, redact);
  return `Codex exited with code ${String(run.code)}${summary ? `: ${summary}` : ''}.`;
}

export interface CodexOptions {
  bin: () => string | null;
  env: Readonly<Record<string, string | undefined>>;
  effort: (request: GenerateRequest) => CodexEffort;
  redact: (text: string) => string;
  spawn?: SpawnLike;
  timeoutMs?: number;
  tempRoot?: string;
}

const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0 };

/** The Codex CLI as a generator. Calls are queued so only one runs at a time. */
export function createCodexGenerator(options: CodexOptions): Generator {
  const spawn = options.spawn ?? (nodeSpawn as unknown as SpawnLike);
  const timeoutMs = options.timeoutMs ?? CONFIG.ai.cliTimeoutMs;
  let queue: Promise<unknown> = Promise.resolve();

  async function call(request: GenerateRequest): Promise<GenerateResponse> {
    const bin = options.bin();
    if (bin === null) {
      return {
        ok: false,
        kind: 'provider_error',
        message: 'The Codex CLI was not found. Install it, or set CODEX_BIN to its path.',
        usage: NO_USAGE,
      };
    }
    const root = options.tempRoot ?? tmpdir();
    const work = await mkdtemp(join(root, 'codex-work-'));
    const io = await mkdtemp(join(root, 'codex-io-'));
    try {
      const out = join(io, 'out.json');
      const args = [
        'exec',
        '--json',
        '--ephemeral',
        '--skip-git-repo-check',
        '--ignore-user-config',
        '--ignore-rules',
        '-s',
        'read-only',
        '-C',
        work,
        '-c',
        `model_reasoning_effort=${options.effort(request)}`,
        '-m',
        request.model.model,
        '-o',
        out,
      ];
      if (request.schema) {
        const schemaPath = join(io, 'schema.json');
        await writeFile(schemaPath, JSON.stringify(strictSchema(request.schema)));
        args.push('--output-schema', schemaPath);
      }
      args.push(`${request.system}\n\n${request.prompt}`);
      const run = await runCodex(spawn, bin, args, childEnv(options.env), timeoutMs);
      const events = readEvents(run.stdout);
      const usage = events.usage ?? NO_USAGE;
      if (run.code !== 0 || run.timedOut || run.spawnError) {
        return {
          ok: false,
          kind: 'provider_error',
          message: describeFailure(run, options.redact),
          usage,
        };
      }
      if (events.failure !== null) {
        return {
          ok: false,
          kind: 'provider_error',
          message: `Codex reported a failure: ${summarizeOutput(events.failure, options.redact)}`,
          usage,
        };
      }
      let answer: string;
      try {
        answer = await readFile(out, 'utf8');
      } catch {
        return {
          ok: false,
          kind: 'invalid_output',
          message: 'Codex finished without writing an answer',
          usage,
        };
      }
      if (!request.schema) return { ok: true, output: answer.trim(), usage };
      try {
        return { ok: true, output: JSON.parse(answer) as unknown, usage };
      } catch {
        return {
          ok: false,
          kind: 'invalid_output',
          message: 'Codex returned an answer that is not valid JSON',
          usage,
        };
      }
    } finally {
      await rm(work, { recursive: true, force: true });
      await rm(io, { recursive: true, force: true });
    }
  }

  return (request) => {
    const result = queue.then(() => call(request));
    queue = result.catch(() => undefined);
    return result;
  };
}

export type CodexLogin =
  { ok: true; method: 'chatgpt' | 'api_key'; message: string } | { ok: false; message: string };

/** `codex login status`: whether the CLI is installed and signed in, and how. */
export async function checkCodexLogin(options: {
  bin: string | null;
  env: Readonly<Record<string, string | undefined>>;
  redact: (text: string) => string;
  spawn?: SpawnLike;
}): Promise<CodexLogin> {
  if (options.bin === null) {
    return {
      ok: false,
      message:
        'The Codex CLI was not found. Install it, or set CODEX_BIN to its path, then run `codex login`.',
    };
  }
  const spawn = options.spawn ?? (nodeSpawn as unknown as SpawnLike);
  const run = await runCodex(
    spawn,
    options.bin,
    ['login', 'status'],
    childEnv(options.env),
    15_000,
  );
  const output = `${run.stdout}\n${run.stderr}`;
  if (/logged in using chatgpt/i.test(output)) {
    return { ok: true, method: 'chatgpt', message: 'Signed in with ChatGPT.' };
  }
  if (/logged in using an api key/i.test(output)) {
    return {
      ok: true,
      method: 'api_key',
      message: 'Signed in with an API key, so calls are billed to that key, not the subscription.',
    };
  }
  if (run.spawnError || run.timedOut)
    return { ok: false, message: describeFailure(run, options.redact) };
  return {
    ok: false,
    message: 'Codex is not signed in. Run `codex login` in a terminal, then check again.',
  };
}
