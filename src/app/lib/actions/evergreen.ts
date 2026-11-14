'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { CONFIG } from '@/core/config';
import { getProduct } from '@/core/db/queries/products';
import { runEvergreenForProduct } from '@/core/serp/evergreen';
import { formatExactUsd } from '../format';
import { getRuntime, nowSeconds } from '../runtime';

export type EvergreenActionResult = { ok: true; message: string } | { ok: false; error: string };

const productId = z.string().min(1).max(100);

/** Saves the searches to check, one per line; an empty list falls back to the buyer phrases. */
export async function saveEvergreenKeywords(input: {
  productId: string;
  keywords: string;
}): Promise<EvergreenActionResult> {
  const parsed = z
    .object({
      productId,
      keywords: z
        .string()
        .max(4_000)
        .transform((text) =>
          text
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        )
        .pipe(
          z
            .array(z.string().min(2, 'Each keyword needs at least two characters.').max(100))
            .max(
              CONFIG.serp.maxKeywords,
              `Use at most ${String(CONFIG.serp.maxKeywords)} keywords.`,
            ),
        ),
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid keywords' };
  const { db, settings } = getRuntime();
  if (!getProduct(db, parsed.data.productId))
    return { ok: false, error: 'That product no longer exists.' };
  settings.setForProduct(parsed.data.productId, 'evergreen.keywords', parsed.data.keywords);
  revalidatePath('/inbox');
  return Promise.resolve({ ok: true, message: 'Keywords saved.' });
}

/** Runs a check now instead of waiting for the weekly one. */
export async function checkEvergreenNow(input: {
  productId: string;
}): Promise<EvergreenActionResult> {
  const parsed = z.object({ productId }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };
  const runtime = getRuntime();
  const fetchSerp = runtime.serp();
  if (!fetchSerp) return { ok: false, error: 'Add DataForSEO credentials in Settings first.' };
  const product = getProduct(runtime.db, parsed.data.productId);
  if (!product) return { ok: false, error: 'That product no longer exists.' };
  const result = await runEvergreenForProduct(
    {
      db: runtime.db,
      fetchSerp,
      log: runtime.log,
      now: nowSeconds(),
      settings: runtime.settings,
    },
    product,
    'manual',
  );
  revalidatePath('/inbox');
  if (!result.ok) return { ok: false, error: result.message };
  const summary = `Found ${String(result.threads)} threads for ${formatExactUsd(result.costUsd)}.`;
  return result.status === 'ok'
    ? { ok: true, message: summary }
    : { ok: false, error: `${result.error ?? 'The check failed.'} ${summary}` };
}
