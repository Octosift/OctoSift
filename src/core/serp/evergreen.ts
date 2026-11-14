/**
 * Evergreen threads: Reddit threads that rank on Google for a buyer's search.
 * People who search "best X for Y" land on them for months, so they are worth
 * a reply even when old, unless Reddit has archived them.
 *
 * A check looks up each buyer keyword, keeps reddit.com threads, and records
 * their rank and the exact cost DataForSEO reported. It runs weekly from the
 * worker or on demand from the dashboard.
 */
import { CONFIG } from '../config';
import type { Db } from '../db/client';
import {
  createSerpRun,
  finishSerpRun,
  recentSerpRuns,
  runningSerpRun,
  upsertSerpThread,
} from '../db/queries/serp';
import type { SerpRunStatus, SerpRunTrigger } from '../db/schema';
import { newId } from '../ids';
import type { Logger } from '../log';
import type { SerpFailureKind, SerpFetcher } from './dataforseo';

export interface RedditThread {
  url: string;
  postId: string;
  subreddit: string;
}

const THREAD_PATH = /^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{3,12})(?:\/|$)/i;

/** The Reddit thread a search result points to, or null for anything else. */
export function redditThread(raw: string): RedditThread | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Search results occasionally carry malformed addresses; they are skipped.
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'reddit.com' && !host.endsWith('.reddit.com')) return null;
  const match = THREAD_PATH.exec(url.pathname);
  if (!match?.[1] || !match[2]) return null;
  const subreddit = match[1].toLowerCase();
  const id = match[2].toLowerCase();
  const rest = url.pathname.slice(match[0].length).split('/')[0] ?? '';
  return {
    url: `https://www.reddit.com/r/${subreddit}/comments/${id}/${rest ? `${rest}/` : ''}`,
    postId: `t3_${id}`,
    subreddit,
  };
}

/** Google shows Reddit titles as "Title : r/sub" or "Title - Reddit"; keep the title. */
export function cleanThreadTitle(title: string): string {
  return title
    .replace(/\s*[:|-]\s*r\/[A-Za-z0-9_]+\s*$/i, '')
    .replace(/\s*[-|:]\s*Reddit\s*$/i, '')
    .trim();
}

/** The keywords to check: the product's own list, or its buyer phrases. */
export function evergreenKeywords(saved: readonly string[], buyerPhrases: readonly string[]) {
  const source = saved.length > 0 ? saved : buyerPhrases;
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of source) {
    const keyword = raw.trim().replace(/\s+/g, ' ');
    const key = keyword.toLowerCase();
    if (keyword.length < 2 || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords.slice(0, CONFIG.serp.maxKeywords);
}

/** Whether the weekly check is due for a product. */
export function evergreenDue(db: Db, productId: string, now: number): boolean {
  if (runningSerpRun(db, productId, now, CONFIG.serp.staleRunS)) return false;
  // A failed attempt also waits a week, so bad credentials do not retry every minute.
  const last = recentSerpRuns(db, productId, 1)[0];
  return !last || now - last.startedAt >= CONFIG.serp.intervalDays * 86_400;
}

export interface EvergreenDeps {
  db: Db;
  fetchSerp: SerpFetcher;
  log: Logger;
  now: number;
}

export type EvergreenResult =
  | {
      ok: true;
      runId: string;
      status: Exclude<SerpRunStatus, 'running'>;
      threads: number;
      costUsd: number;
      error: string | null;
    }
  | { ok: false; message: string };

/** Runs `work` over `items` with at most `limit` in flight, stopping early when asked. */
async function inPool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<boolean>,
): Promise<void> {
  let next = 0;
  let stop = false;
  async function lane(): Promise<void> {
    while (!stop && next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined && !(await work(item))) stop = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

const FATAL: readonly SerpFailureKind[] = ['auth', 'funds'];

export async function runEvergreenCheck(
  deps: EvergreenDeps,
  input: { productId: string; keywords: readonly string[]; trigger: SerpRunTrigger },
): Promise<EvergreenResult> {
  const { db, fetchSerp, log, now } = deps;
  if (input.keywords.length === 0) {
    return { ok: false, message: 'Add at least one keyword to check.' };
  }
  if (runningSerpRun(db, input.productId, now, CONFIG.serp.staleRunS)) {
    return { ok: false, message: 'A check is already running for this product.' };
  }
  const runId = newId();
  createSerpRun(db, {
    id: runId,
    productId: input.productId,
    trigger: input.trigger,
    keywords: input.keywords.length,
    now,
  });

  let costUsd = 0;
  let succeeded = 0;
  let failed = 0;
  let firstError: string | null = null;
  const threadIds = new Set<string>();

  await inPool(input.keywords, CONFIG.serp.concurrency, async (keyword) => {
    const result = await fetchSerp(keyword);
    costUsd += result.costUsd;
    if (!result.ok) {
      failed += 1;
      firstError ??= result.message;
      log.warn('Evergreen keyword check failed', { keyword, kind: result.kind });
      // Bad credentials or an empty balance fail every keyword; stop spending calls.
      return !FATAL.includes(result.kind);
    }
    succeeded += 1;
    for (const item of result.items) {
      const thread = redditThread(item.url);
      if (!thread) continue;
      threadIds.add(thread.url);
      upsertSerpThread(db, {
        id: newId(),
        productId: input.productId,
        keyword,
        url: thread.url,
        postId: thread.postId,
        subreddit: thread.subreddit,
        title: cleanThreadTitle(item.title),
        rank: item.rank,
        publishedAt: item.publishedAt,
        archived: item.publishedAt !== null && now - item.publishedAt > CONFIG.reddit.archiveAfterS,
        runId,
        checkedAt: now,
      });
    }
    return true;
  });

  const status = failed === 0 ? 'ok' : succeeded === 0 ? 'failed' : 'partial';
  // Summing floats leaves noise; DataForSEO bills in millionths of a dollar at most.
  const cost = Math.round(costUsd * 1_000_000) / 1_000_000;
  finishSerpRun(db, runId, {
    status,
    threads: threadIds.size,
    costUsd: cost,
    error: firstError,
    now,
  });
  return { ok: true, runId, status, threads: threadIds.size, costUsd: cost, error: firstError };
}
