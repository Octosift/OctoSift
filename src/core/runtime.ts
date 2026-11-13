/**
 * Wires the real implementations together for the worker, the CLI and the
 * dashboard. Everything below this module takes its dependencies as
 * arguments; this is the one place that decides which ones are used.
 */
import { dirname, resolve } from 'node:path';
import {
  createAiClient,
  createModelResolver,
  type AiClient,
  type ModelResolution,
} from './ai/client';
import { createSdkGenerator } from './ai/provider';
import type { AiStage, Generator } from './ai/types';
import { createUsageLedger } from './ai/usage';
import { systemClock, type Clock, type Random } from './clock';
import { CONFIG } from './config';
import { openDatabase, type Db } from './db/client';
import type { AppEnv } from './env';
import { createLogger, type Logger, type LogRecord } from './log';
import type { ScanDeps } from './pipeline/run';
import { createRedditClient } from './reddit/client';
import { createRateLimiter } from './reddit/ratelimit';
import { createAtomSource } from './reddit/source';
import type { RedditSource } from './reddit/types';
import { loadMasterKey } from './secrets/crypto';
import { createRedactor, type Redactor } from './secrets/redact';
import { createSecretStore, type SecretStore } from './secrets/store';
import { createSettingsStore, type SettingsStore } from './settings/store';
import { readState, writeState } from './state';

export interface Runtime {
  env: AppEnv;
  db: Db;
  settings: SettingsStore;
  secrets: SecretStore;
  redactor: Redactor;
  log: Logger;
  clock: Clock;
  random: Random;
  source: RedditSource;
  generator: Generator;
  resolveModel: (stage: AiStage) => ModelResolution;
  /** An AI client for calls outside a scan (onboarding, regenerating a draft). */
  ai(): AiClient;
  scanDeps(): ScanDeps;
  close(): void;
}

export interface RuntimeOptions {
  env: AppEnv;
  /** The raw environment, for provider keys supplied as variables. */
  rawEnv: Readonly<Record<string, string | undefined>>;
  clock?: Clock;
  random?: Random;
  logSink?: (record: LogRecord) => void;
  /** Replacements used by demo mode and tests. */
  overrides?: {
    source?: RedditSource;
    generator?: Generator;
    resolveModel?: (stage: AiStage) => ModelResolution;
    extendScanDeps?: (deps: ScanDeps) => ScanDeps;
  };
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { env } = options;
  const clock = options.clock ?? systemClock;
  const random = options.random ?? (() => Math.random());
  const databasePath = resolve(process.cwd(), env.DATABASE_PATH);
  const db = openDatabase({ path: databasePath });
  const redactor = createRedactor();
  const log = createLogger({
    level: env.LOG_LEVEL,
    redactor,
    ...(options.logSink ? { sink: options.logSink } : {}),
  });
  const settings = createSettingsStore(db);
  const key = loadMasterKey({
    appSecret: env.APP_SECRET,
    keyFilePath: resolve(dirname(databasePath), '.secret'),
  });
  const secrets = createSecretStore({
    db,
    key,
    env: options.rawEnv,
    redactor,
    now: () => Math.floor(clock.nowMs() / 1000),
  });
  secrets.loadIntoRedactor();

  const limiter = createRateLimiter({
    clock,
    random,
    minSpacingMs: CONFIG.reddit.minSpacingMs,
    maxJitterMs: CONFIG.reddit.maxJitterMs,
    maxWaitMs: 120_000,
  });
  const pausedUntil = readState(db, 'state.redditPausedUntil');
  if (pausedUntil !== null) limiter.pause(pausedUntil * 1000);
  const client = createRedditClient({
    limiter,
    clock,
    log,
    userAgent: () => settings.get('reddit.userAgent'),
    proxyUrl: () => {
      const proxy = secrets.use('reddit_proxy_url');
      return proxy.ok ? proxy.value : null;
    },
    onBlock: (untilMs) => {
      writeState(db, 'state.redditPausedUntil', Math.ceil(untilMs / 1000));
    },
  });

  const source = options.overrides?.source ?? createAtomSource({ client, clock });
  const generator = options.overrides?.generator ?? createSdkGenerator();
  const resolveModel = options.overrides?.resolveModel ?? createModelResolver(settings, secrets);

  return {
    env,
    db,
    settings,
    secrets,
    redactor,
    log,
    clock,
    random,
    source,
    generator,
    resolveModel,
    ai: () =>
      createAiClient({
        generator,
        resolveModel,
        usage: createUsageLedger({
          db,
          clock,
          runId: null,
          prices: () => settings.get('ai.prices'),
          caps: () => ({
            perRunUsd: Number.POSITIVE_INFINITY,
            perDayUsd: settings.get('budget.perDayUsd'),
          }),
        }),
        redact: redactor.redact,
        log,
      }),
    scanDeps: () => {
      const deps: ScanDeps = {
        db,
        source,
        generator,
        resolveModel,
        settings,
        clock,
        random,
        log,
        redact: redactor.redact,
      };
      return options.overrides?.extendScanDeps?.(deps) ?? deps;
    },
    close: () => {
      db.$client.close();
    },
  };
}
