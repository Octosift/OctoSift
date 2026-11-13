'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  getProduct,
  setSubredditEnabled,
  unwatchSubreddit,
  watchSubreddit,
} from '@/core/db/queries/products';
import { setPromotionPolicy, setSubredditStatus } from '@/core/db/queries/subreddits';
import { requestValidation } from '@/core/validation-queue';
import { getRuntime, nowSeconds } from '../runtime';

export type SubredditActionResult = { ok: true } | { ok: false; error: string };

const name = z
  .string()
  .trim()
  .transform((value) => value.replace(/^\/?r\//i, '').toLowerCase())
  .pipe(
    z.string().regex(/^[a-z0-9_]{2,21}$/, 'Subreddit names use letters, digits and underscores'),
  );
const productId = z.string().min(1).max(100);

function done(): SubredditActionResult {
  revalidatePath('/subreddits');
  return { ok: true };
}

export async function addSubreddit(input: {
  productId: string;
  name: string;
}): Promise<SubredditActionResult> {
  const parsed = z.object({ productId, name }).safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid name' };
  const { db } = getRuntime();
  if (!getProduct(db, parsed.data.productId))
    return { ok: false, error: 'That product no longer exists.' };
  watchSubreddit(db, parsed.data.productId, parsed.data.name, nowSeconds());
  requestValidation(db, [parsed.data.name], nowSeconds());
  return Promise.resolve(done());
}

export async function setReading(input: {
  productId: string;
  name: string;
  enabled: boolean;
}): Promise<SubredditActionResult> {
  const parsed = z.object({ productId, name, enabled: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };
  setSubredditEnabled(
    getRuntime().db,
    parsed.data.productId,
    parsed.data.name,
    parsed.data.enabled,
  );
  return Promise.resolve(done());
}

export async function removeSubreddit(input: {
  productId: string;
  name: string;
}): Promise<SubredditActionResult> {
  const parsed = z.object({ productId, name }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };
  unwatchSubreddit(getRuntime().db, parsed.data.productId, parsed.data.name);
  return Promise.resolve(done());
}

export async function setPolicy(input: {
  name: string;
  policy: string;
}): Promise<SubredditActionResult> {
  const parsed = z
    .object({ name, policy: z.enum(['unknown', 'allowed', 'no_promotion']) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };
  setPromotionPolicy(getRuntime().db, parsed.data.name, parsed.data.policy);
  return Promise.resolve(done());
}

/** Gives a subreddit marked as missing another chance, for example after a typo was fixed on Reddit's side. */
export async function retrySubreddit(input: { name: string }): Promise<SubredditActionResult> {
  const parsed = z.object({ name }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };
  const { db } = getRuntime();
  setSubredditStatus(db, parsed.data.name, 'active');
  requestValidation(db, [parsed.data.name], nowSeconds());
  return Promise.resolve(done());
}
