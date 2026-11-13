'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getProduct } from '@/core/db/queries/products';
import { requestScan } from '@/core/scan-lock';
import { getRuntime, nowSeconds } from '../runtime';

const input = z.object({ productId: z.string().min(1).nullable() });

/** "Scan now": leaves a request the worker picks up within a few seconds. */
export async function requestScanAction(productId: string | null): Promise<{ ok: boolean }> {
  const parsed = input.safeParse({ productId });
  if (!parsed.success) return { ok: false };
  const { db } = getRuntime();
  if (parsed.data.productId && !getProduct(db, parsed.data.productId)) return { ok: false };
  requestScan(db, parsed.data.productId, nowSeconds());
  revalidatePath('/', 'layout');
  return Promise.resolve({ ok: true });
}
