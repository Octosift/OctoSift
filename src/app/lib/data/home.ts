import 'server-only';
import { and, count, eq, gte } from 'drizzle-orm';
import { countByTab, listLeads } from '@/core/db/queries/inbox';
import { listProducts, watchedSubreddits } from '@/core/db/queries/products';
import { recentRuns } from '@/core/db/queries/runs';
import { leads, runs } from '@/core/db/schema';
import { sessionStatus } from '@/core/reddit/account';
import { AI_STAGES } from '@/core/settings/registry';
import { readWorkerStatus } from '@/core/worker-status';
import { BRAND } from '@/core/brand';
import { updateView } from '@/core/updates/check';
import { stepHref, type StepId } from '../../onboarding/steps';
import { getRuntime, nowSeconds } from '../runtime';

const WEEK_S = 7 * 86_400;

export interface SetupItem {
  id: StepId;
  title: string;
  body: string;
  done: boolean;
  optional: boolean;
  href: string;
}

/** The setup steps and which are done; Home lists them and the sidebar counts them. */
export function loadSetup(): SetupItem[] {
  const runtime = getRuntime();
  const { db, secrets, env } = runtime;
  const product = listProducts(db).at(-1) ?? null;
  const subreddits = product ? watchedSubreddits(db, product.id) : [];
  const lastRun = recentRuns(db, 1)[0] ?? null;
  const aiReady = AI_STAGES.every((stage) => runtime.resolveModel(stage).ok);
  const accountConnected = sessionStatus(db, secrets).status === 'connected';

  return [
    {
      id: 'ai',
      title: 'Connect an AI provider',
      body: 'One API key and a preset. The AI reads posts and writes drafts.',
      done: aiReady || env.DEMO_MODE,
      optional: false,
      href: stepHref('ai'),
    },
    {
      id: 'account',
      title: 'Connect a Reddit account',
      body: 'Optional. Reading is several times faster with a separate account.',
      done: accountConnected || env.DEMO_MODE,
      optional: true,
      href: stepHref('account'),
    },
    {
      id: 'product',
      title: 'Describe your product',
      body: 'Paste your website and the profile is drafted for you.',
      done: product !== null,
      optional: false,
      href: stepHref('product'),
    },
    {
      id: 'subreddits',
      title: 'Choose subreddits',
      body: 'Confirm where your customers ask questions.',
      done: subreddits.length > 0,
      optional: false,
      href: stepHref('subreddits'),
    },
    {
      id: 'scan',
      title: 'Run the first scan',
      body: 'Reads recent posts and fills your inbox with leads.',
      done: lastRun !== null,
      optional: false,
      href: stepHref('scan'),
    },
  ];
}

/** Whether every required step is done. */
export function setupComplete(items: readonly SetupItem[]): boolean {
  return items.every((item) => item.done || item.optional);
}

/** Everything Home shows: what is left to set up, and how the search is going. */
export function loadHome() {
  const runtime = getRuntime();
  const { db, secrets, settings, env } = runtime;
  const now = nowSeconds();
  const product = listProducts(db).at(-1) ?? null;
  const subreddits = product ? watchedSubreddits(db, product.id) : [];
  const lastRun = recentRuns(db, 1)[0] ?? null;
  const accountConnected = sessionStatus(db, secrets).status === 'connected';
  const setup = loadSetup();

  const repliedThisWeek =
    db
      .select({ value: count() })
      .from(leads)
      .where(and(eq(leads.status, 'replied'), gte(leads.repliedAt, now - WEEK_S)))
      .get()?.value ?? 0;
  const week = db
    .select({ cost: runs.costUsd, api: runs.apiEquivalentUsd })
    .from(runs)
    .where(and(gte(runs.startedAt, now - WEEK_S), eq(runs.dryRun, false)))
    .all();

  return {
    now,
    product: product ? { id: product.id, name: product.name } : null,
    setup,
    setupDone: setupComplete(setup),
    stats: {
      toDo: countByTab(db).todo,
      repliedThisWeek,
      spentThisWeekUsd: week.reduce((total, row) => total + row.cost, 0),
      apiEquivalentThisWeekUsd: week.some((row) => row.api !== null)
        ? week.reduce((total, row) => total + (row.api ?? 0), 0)
        : null,
    },
    lastRun: lastRun
      ? {
          id: lastRun.id,
          startedAt: lastRun.startedAt,
          status: lastRun.status,
          fetched:
            typeof lastRun.countsJson === 'object' &&
            lastRun.countsJson !== null &&
            'fetched' in lastRun.countsJson
              ? Number(lastRun.countsJson.fetched)
              : 0,
        }
      : null,
    intervalMinutes: settings.get('schedule.intervalMinutes'),
    subredditCount: subreddits.length,
    accountConnected,
    demo: env.DEMO_MODE,
    worker: readWorkerStatus(db, runtime.clock.nowMs()),
    leads: listLeads(db, { tab: 'todo' }, { limit: 5, offset: 0, now }).rows,
    version: BRAND.version,
    notices: updateView(db, { enabled: runtime.updatesEnabled(), currentVersion: BRAND.version }),
  };
}

export type HomeData = ReturnType<typeof loadHome>;
