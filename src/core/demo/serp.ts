/**
 * Demo mode's stand-in for DataForSEO: synthetic Google results for the Acme
 * Invoices buyer phrases, with a few other sites mixed in like real results.
 * No network and no account are needed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { nowSeconds, type Clock } from '../clock';
import type { SerpFetcher, SerpItem } from '../serp/dataforseo';

const fixtureSchema = z.object({
  note: z.string(),
  costPerKeywordUsd: z.number().nonnegative(),
  results: z.record(
    z.string(),
    z.array(
      z.object({
        rank: z.number().int().positive(),
        subreddit: z.string(),
        id: z.string(),
        slug: z.string(),
        title: z.string(),
        ageDays: z.number().nonnegative().nullable(),
      }),
    ),
  ),
});

const DAY_S = 86_400;

export function createDemoSerpFetcher(
  clock: Clock,
  options: { root?: string; latencyMs?: number } = {},
): SerpFetcher {
  const root = options.root ?? resolve(process.cwd(), 'fixtures/demo');
  const fixture = fixtureSchema.parse(
    JSON.parse(readFileSync(resolve(root, 'acme-invoices-serp.json'), 'utf8')) as unknown,
  );
  const results = new Map(
    Object.entries(fixture.results).map(([keyword, rows]) => [keyword.toLowerCase(), rows]),
  );
  const latencyMs = options.latencyMs ?? 0;

  return async (keyword) => {
    if (latencyMs > 0) {
      await new Promise((done) => {
        setTimeout(done, latencyMs);
      });
    }
    const now = nowSeconds(clock);
    const threads: SerpItem[] = (results.get(keyword.toLowerCase()) ?? []).map((row) => ({
      rank: row.rank,
      url: `https://www.reddit.com/r/${row.subreddit}/comments/${row.id}/${row.slug}/`,
      title: `${row.title} : r/${row.subreddit}`,
      publishedAt: row.ageDays === null ? null : now - Math.round(row.ageDays * DAY_S),
    }));
    const taken = new Set(threads.map((item) => item.rank));
    const others: SerpItem[] = [1, 2, 3, 4, 5, 6]
      .filter((rank) => !taken.has(rank))
      .slice(0, 3)
      .map((rank) => ({
        rank,
        url: `https://blog.example.com/${keyword.replace(/\W+/g, '-')}-${String(rank)}`,
        title: `Guide: ${keyword}`,
        publishedAt: null,
      }));
    return {
      ok: true,
      items: [...threads, ...others].sort((a, b) => a.rank - b.rank),
      costUsd: fixture.costPerKeywordUsd,
    };
  };
}
