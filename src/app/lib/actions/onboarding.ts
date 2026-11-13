'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { profileWire, type ExtractedProfile } from '@/core/ai/schemas';
import { CONFIG } from '@/core/config';
import { insertProduct, getProduct, watchSubreddit } from '@/core/db/queries/products';
import { recentRuns } from '@/core/db/queries/runs';
import { loadSampleProducts } from '@/core/demo/sample-products';
import { newId } from '@/core/ids';
import type { FunnelCounts } from '@/core/pipeline/funnel';
import { crawlProduct } from '@/core/profile/crawl';
import { extractProfile, mergeInterview } from '@/core/profile/extract';
import { suggestSubreddits } from '@/core/profile/subreddits';
import { requestScan } from '@/core/scan-lock';
import {
  requestValidation,
  validationProgress,
  type ValidationProgress,
} from '@/core/validation-queue';
import { getRuntime, nowSeconds } from '../runtime';

const pageSchema = z.object({
  url: z.string().max(2_000),
  title: z.string().max(500),
  text: z.string().max(CONFIG.crawl.maxCharsPerPage),
});
type Page = z.output<typeof pageSchema>;

export type CrawlResponse =
  { ok: true; pages: Page[] } | { ok: false; message: string; askForDescription: boolean };

export async function crawlSite(rawUrl: string): Promise<CrawlResponse> {
  const url = z.url().safeParse(rawUrl.trim());
  if (!url.success)
    return {
      ok: false,
      message: 'Enter a full web address starting with https://',
      askForDescription: false,
    };
  const runtime = getRuntime();
  if (runtime.env.DEMO_MODE) {
    // Demo mode never touches the network; sample products answer from fixtures.
    const sample = Object.values(loadSampleProducts()).find(
      (profile) => profile.url === url.data.replace(/\/$/, ''),
    );
    return sample
      ? { ok: true, pages: [{ url: sample.url, title: sample.name, text: sample.one_liner }] }
      : {
          ok: false,
          message:
            'Demo mode only knows the sample products, such as https://acme-invoices.example',
          askForDescription: true,
        };
  }
  const result = await crawlProduct(url.data);
  if (!result.ok)
    return { ok: false, message: result.message, askForDescription: result.kind !== 'invalid_url' };
  return { ok: true, pages: result.pages };
}

const extractInput = z.object({
  url: z.url(),
  pages: z.array(pageSchema).max(CONFIG.crawl.maxExtraPages + 1),
  description: z.string().trim().max(6_000).nullable(),
});

export async function buildProfile(
  input: z.input<typeof extractInput>,
): Promise<{ ok: true; profile: ExtractedProfile } | { ok: false; message: string }> {
  const parsed = extractInput.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: 'The site content could not be used. Paste a description instead.',
    };
  const runtime = getRuntime();
  const url = parsed.data.url.replace(/\/$/, '');
  return extractProfile(runtime.ai(), {
    url,
    pages: parsed.data.pages,
    description: parsed.data.description,
  });
}

const answersSchema = z.object({
  bestCustomer: z.string().trim().max(1_000),
  misconceptions: z.string().trim().max(1_000),
  neverReplyTo: z.string().trim().max(1_000),
  includeLinks: z.boolean(),
  redditUsername: z.string().trim().max(40),
  openAnswers: z
    .array(z.object({ question: z.string().max(300), answer: z.string().max(1_000) }))
    .max(5),
});

const createInput = z.object({
  url: z.url(),
  profile: profileWire.extend({
    name: z.string().trim().min(1, 'Give the product a name').max(80),
    one_liner: z.string().trim().min(1, 'Describe the product in one line').max(160),
  }),
  answers: answersSchema,
});

export type CreateProductResult =
  { ok: true; productId: string } | { ok: false; errors: Record<string, string> };

export async function createProduct(
  input: z.input<typeof createInput>,
): Promise<CreateProductResult> {
  const parsed = createInput.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[issue.path.join('.')] ??= issue.message;
    return { ok: false, errors };
  }
  const { db } = getRuntime();
  const productId = newId();
  const profile = mergeInterview(
    parsed.data.profile,
    parsed.data.url.replace(/\/$/, ''),
    parsed.data.answers,
  );
  insertProduct(db, { id: productId, profile, now: nowSeconds() });
  if (profile.reddit_username)
    getRuntime().settings.set('reddit.ownUsername', profile.reddit_username);
  revalidatePath('/', 'layout');
  return Promise.resolve({ ok: true, productId });
}

export async function suggestForProduct(
  productId: string,
): Promise<
  | { ok: true; suggestions: { name: string; reason: string; promotionStrictness: string }[] }
  | { ok: false; message: string }
> {
  const runtime = getRuntime();
  const product = getProduct(runtime.db, productId);
  if (!product?.profile) return { ok: false, message: 'Create the product first.' };
  return suggestSubreddits(runtime.ai(), product.profile);
}

const names = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]{2,21}$/, 'Subreddit names use letters, digits and underscores'),
  )
  .min(1)
  .max(CONFIG.subreddits.maxSuggestions + 10);

export async function checkSubreddits(input: string[]): Promise<{ ok: boolean; error?: string }> {
  const parsed = names.safeParse(input.map((name) => name.replace(/^\/?r\//i, '')));
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid names' };
  requestValidation(getRuntime().db, [...new Set(parsed.data)], nowSeconds());
  return Promise.resolve({ ok: true });
}

export async function checkProgress(): Promise<ValidationProgress | null> {
  return Promise.resolve(validationProgress(getRuntime().db));
}

export async function saveSubreddits(input: {
  productId: string;
  names: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const { min, maxSelected } = {
    min: CONFIG.subreddits.minSelected,
    maxSelected: CONFIG.subreddits.maxSelected,
  };
  const parsed = names
    .min(min, `Pick at least ${min} subreddits`)
    .max(maxSelected, `Pick at most ${maxSelected} subreddits`)
    .safeParse(input.names);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid names' };
  const { db } = getRuntime();
  if (!getProduct(db, input.productId)) return { ok: false, error: 'Create the product first.' };
  const now = nowSeconds();
  for (const name of new Set(parsed.data)) watchSubreddit(db, input.productId, name, now);
  revalidatePath('/', 'layout');
  return Promise.resolve({ ok: true });
}

export async function startFirstScan(productId: string): Promise<{ requestedAt: number }> {
  const { db } = getRuntime();
  const requestedAt = nowSeconds();
  requestScan(db, getProduct(db, productId) ? productId : null, requestedAt);
  return Promise.resolve({ requestedAt });
}

export interface ScanProgress {
  status: string;
  counts: FunnelCounts | null;
  error: string | null;
}

export async function firstScanProgress(since: number): Promise<ScanProgress | null> {
  const run = recentRuns(getRuntime().db, 1)[0];
  if (!run || run.startedAt < since) return Promise.resolve(null);
  return Promise.resolve({
    status: run.status,
    counts: run.countsJson as FunnelCounts,
    error: run.error,
  });
}

export async function completeOnboarding(): Promise<void> {
  getRuntime().settings.set('onboarding.completed', true);
  revalidatePath('/', 'layout');
  return Promise.resolve();
}
