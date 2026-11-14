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
import { runAccountCheck } from './guard/account-check';
import { runDueReplyChecks } from './guard/visibility';
import { nowSeconds, systemClock, type Clock, type Random } from './clock';
import { CONFIG } from './config';
import { openDatabase, type Db } from './db/client';
import { feedbackContext } from './db/queries/feedback';
import type { AppEnv } from './env';
import { createLogger, type Logger, type LogRecord } from './log';
import { sendWebhook } from './notify/webhook';
import type { ScanDeps } from './pipeline/run';
import { createRedditClient } from './reddit/client';
import { createRateLimiter } from './reddit/ratelimit';
import { markSessionNeedsReauth, sessionStatus } from './reddit/account';
import { createSourceChain, sourceOrder, type SourceCandidate } from './reddit/chain';
import { createProviderSource } from './reddit/provider/source';
import { createVendorClient } from './reddit/provider/vendor';
import { createSessionSource } from './reddit/session';
import { createSessionClient } from './reddit/session-client';
import { createAtomSource } from './reddit/source';
import type { RedditSource } from './reddit/types';
import { loadMasterKey } from './secrets/crypto';
import { createRedactor, type Redactor } from './secrets/redact';
import { createSecretStore, type SecretStore } from './secrets/store';
import { createDataForSeoFetcher, type SerpFetcher } from './serp/dataforseo';
import { createSettingsStore, type SettingsStore } from './settings/store';
import { clearState, readState, writeState } from './state';

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
  /** Google results for evergreen threads; null until DataForSEO credentials are saved. */
  serp(): SerpFetcher | null;
  /** Whether a Reddit account is connected, which reply checks read with. */
  hasRedditAccount(): boolean;
  /**
   * Runs the reply checks that are due, then the daily profile check of the
   * connected account, all through its session.
   */
  checkVisibility(): Promise<void>;
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
    serp?: SerpFetcher;
    extendScanDeps?: (deps: ScanDeps) => ScanDeps;
  };
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { env } = options;
  const clock = options.clock ?? systemClock;
  const random = options.random ?? (() => Math.random());
  // The database location is chosen at runtime, so the bundler must not trace it.
  const databasePath = resolve(/* turbopackIgnore: true */ process.cwd(), env.DATABASE_PATH);
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

  const rssSource = createAtomSource({ client, clock });
  // One limiter for the session for the life of the process, so pacing holds across scans.
  const sessionLimiter = createRateLimiter({
    clock,
    random,
    minSpacingMs: CONFIG.session.minSpacingMs,
    maxJitterMs: CONFIG.session.maxJitterMs,
    maxWaitMs: 120_000,
    maxPerHour: CONFIG.session.maxPerHour,
  });

  // The provider has its own limiter: a few requests a second, unrelated to Reddit's pace.
  const providerLimiter = createRateLimiter({
    clock,
    random,
    minSpacingMs: Math.ceil(1_000 / CONFIG.provider.perSecond),
    maxJitterMs: 0,
    maxWaitMs: 60_000,
  });
  const providerSource = createProviderSource({
    client: createVendorClient({
      key: () => {
        const key = secrets.use('vendor_api_key');
        return key.ok ? key.value : null;
      },
      limiter: providerLimiter,
      clock,
      redact: redactor.redact,
    }),
    clock,
    maxPostAgeHours: () => settings.get('prefilter.maxPostAgeHours'),
    pricePerRequestUsd: () => settings.get('reddit.providerPriceUsd'),
    name: 'vendor',
  });

  /**
   * A client for the connected account. Every client shares the session's
   * limiter, so scans and checks keep one pace and one hourly cap.
   */
  function sessionClient(webPageMeansSignedOut: boolean) {
    return createSessionClient({
      cookie: () => {
        const cookie = secrets.use('reddit_session_cookie');
        return cookie.ok ? cookie.value : null;
      },
      userAgent: () => settings.get('reddit.userAgent'),
      limiter: sessionLimiter,
      clock,
      webPageMeansSignedOut,
      onInvalid: (reason) => {
        markSessionNeedsReauth(db, reason, nowSeconds(clock));
        log.warn('Reddit session needs reconnecting', { reason });
      },
    });
  }
  const hasRedditAccount = () => sessionStatus(db, secrets).status === 'connected';

  /** The sources that are set up, in the order the user prefers. */
  function candidates(): SourceCandidate[] {
    const available: SourceCandidate[] = [];
    for (const id of sourceOrder(settings.get('reddit.source'))) {
      if (id === 'rss') available.push({ id, source: rssSource });
      if (id === 'provider' && secrets.describe('vendor_api_key').configured) {
        available.push({ id, source: providerSource });
      }
      if (id === 'session' && hasRedditAccount()) {
        available.push({
          id,
          source: createSessionSource({
            client: sessionClient(true),
            clock,
            maxPostAgeHours: () => settings.get('prefilter.maxPostAgeHours'),
          }),
        });
      }
    }
    return available;
  }

  /** A fresh chain: each scan starts again from the preferred source. */
  function buildSource(): RedditSource {
    if (options.overrides?.source) return options.overrides.source;
    return createSourceChain(candidates(), {
      failover: settings.get('reddit.failover'),
      onFailover: (from, to, reason) => {
        writeState(db, 'state.sourceFailover', { from, to, reason, at: nowSeconds(clock) });
        log.warn('Reddit source failed; trying the next one', { from, to, reason });
      },
      onPreferredWorks: () => {
        if (readState(db, 'state.sourceFailover')) clearState(db, 'state.sourceFailover');
      },
    });
  }

  const source = buildSource();
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
    hasRedditAccount,
    checkVisibility: async () => {
      if (!hasRedditAccount()) return;
      const session = sessionStatus(db, secrets);
      const username = session.status === 'connected' ? session.username : null;
      const reddit = sessionClient(false);
      await runDueReplyChecks({ db, reddit, account: username, now: nowSeconds(clock), log });
      // A refusal during the reply checks leaves the session needing reconnection.
      if (!hasRedditAccount()) return;
      await runAccountCheck({ db, reddit, username, now: nowSeconds(clock), log });
    },
    serp: () => {
      if (options.overrides?.serp) return options.overrides.serp;
      const login = secrets.use('dataforseo_login');
      const password = secrets.use('dataforseo_password');
      return login.ok && password.ok
        ? createDataForSeoFetcher({ login: login.value, password: password.value })
        : null;
    },
    scanDeps: () => {
      const deps: ScanDeps = {
        db,
        source: buildSource(),
        generator,
        resolveModel,
        settings,
        clock,
        random,
        log,
        redact: redactor.redact,
        feedbackFor: (productId) => feedbackContext(db, productId),
        notify: async (notice) => {
          const hook = secrets.use('webhook_url');
          if (!hook.ok) return false;
          const result = await sendWebhook({
            url: hook.value,
            format: settings.get('notify.format'),
            lead: notice,
            dashboardUrl: env.PUBLIC_URL,
          });
          if (!result.ok) log.warn('Lead notification failed', { reason: result.message });
          return result.ok;
        },
      };
      return options.overrides?.extendScanDeps?.(deps) ?? deps;
    },
    close: () => {
      db.$client.close();
    },
  };
}
