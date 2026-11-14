import 'server-only';
import { CONFIG } from '@/core/config';
import { countByTab } from '@/core/db/queries/inbox';
import { listProducts } from '@/core/db/queries/products';
import {
  lastCompletedSerpRun,
  recentSerpRuns,
  runningSerpRun,
  threadsForRun,
} from '@/core/db/queries/serp';
import { evergreenKeywords } from '@/core/serp/evergreen';
import { getRuntime, nowSeconds } from '../runtime';

/** Threads worth answering from the newest check, or null while DataForSEO is not set up. */
export function evergreenCount(productId: string | undefined): number | null {
  const runtime = getRuntime();
  if (!runtime.serp()) return null;
  const products = listProducts(runtime.db);
  const ids = productId ? [productId] : products.map((product) => product.id);
  let total = 0;
  for (const id of ids) {
    const run = lastCompletedSerpRun(runtime.db, id);
    if (run) total += threadsForRun(runtime.db, run.id).filter((thread) => !thread.archived).length;
  }
  return total;
}

export function loadEvergreen(productParam: string | undefined) {
  const runtime = getRuntime();
  const { db, settings } = runtime;
  if (!runtime.serp()) return null;
  const products = listProducts(db);
  const product = products.find((candidate) => candidate.id === productParam) ?? products[0];
  if (!product) return null;
  const now = nowSeconds();
  const saved = settings.getForProduct(product.id, 'evergreen.keywords');
  const completed = lastCompletedSerpRun(db, product.id);
  return {
    now,
    product: { id: product.id, name: product.name },
    products: products.map(({ id, name }) => ({ id, name })),
    keywords: evergreenKeywords(saved, product.profile?.buyer_phrases ?? []),
    usingBuyerPhrases: saved.length === 0,
    maxKeywords: CONFIG.serp.maxKeywords,
    running: runningSerpRun(db, product.id, now, CONFIG.serp.staleRunS) !== null,
    runs: recentSerpRuns(db, product.id, 5),
    checkedAt: completed?.finishedAt ?? null,
    threads: completed ? threadsForRun(db, completed.id) : [],
    counts: countByTab(db, productParam),
    evergreen: evergreenCount(productParam),
  };
}

export type EvergreenData = NonNullable<ReturnType<typeof loadEvergreen>>;
