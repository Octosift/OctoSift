'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { dismissUpdateNotice } from '@/core/updates/check';
import { getRuntime } from '../runtime';

const notice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('update'), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  z.object({ kind: z.literal('announcement'), key: z.string().regex(/^[0-9a-f]{16}$/) }),
]);

/** Closes the update notice for one version, or one announcement. */
export async function dismissNotice(input: unknown): Promise<{ ok: boolean }> {
  const parsed = notice.safeParse(input);
  if (!parsed.success) return { ok: false };
  dismissUpdateNotice(getRuntime().db, parsed.data);
  revalidatePath('/');
  return Promise.resolve({ ok: true });
}
