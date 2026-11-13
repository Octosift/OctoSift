'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { profileWire } from '@/core/ai/schemas';
import { updateFeedbackNote } from '@/core/db/queries/feedback';
import { deleteProduct, getProduct, listProducts, updateProduct } from '@/core/db/queries/products';
import { buildShortProfile } from '@/core/profile/extract';
import { SETTINGS } from '@/core/settings/registry';
import { formatIssues } from '@/core/settings/store';
import { getRuntime, nowSeconds } from '../runtime';

export type ProductResult = { ok: true } | { ok: false; errors: Record<string, string> };

const productId = z.string().min(1).max(100);

const profileInput = profileWire.omit({ open_questions: true }).extend({
  name: z.string().trim().min(1, 'Give the product a name').max(80),
  one_liner: z.string().trim().min(1, 'Describe the product in one line').max(160),
  url: z.url('Enter the full website address'),
  best_customer: z.string().trim().max(1_000),
  misconceptions: z.string().trim().max(1_000),
  never_reply_to: z.string().trim().max(1_000),
  include_links: z.boolean(),
  reddit_username: z.string().trim().max(40).nullable(),
});

function issuesToErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[issue.path.join('.') || 'form'] ??= issue.message;
  return errors;
}

export async function saveProfile(input: {
  productId: string;
  profile: z.input<typeof profileInput>;
}): Promise<ProductResult> {
  const parsed = z.object({ productId, profile: profileInput }).safeParse(input);
  if (!parsed.success) return { ok: false, errors: issuesToErrors(parsed.error) };
  const { db } = getRuntime();
  const product = getProduct(db, parsed.data.productId);
  if (!product?.profile) return { ok: false, errors: { form: 'This product no longer exists.' } };
  const { url, ...rest } = parsed.data.profile;
  const merged = {
    ...product.profile,
    ...rest,
    url: url.replace(/\/$/, ''),
    reddit_username: rest.reddit_username ? rest.reddit_username.replace(/^\/?u\//i, '') : null,
  };
  updateProduct(
    db,
    product.id,
    { profile: { ...merged, short: buildShortProfile(merged) } },
    nowSeconds(),
  );
  revalidatePath('/', 'layout');
  return Promise.resolve({ ok: true });
}

const replyInput = z.object({
  productId,
  mode: z.enum(['helpful_only', 'soft_mention', 'direct']),
  includeLinks: z.boolean(),
  dmDrafts: z.boolean().nullable(),
});

export async function saveReplySettings(input: z.input<typeof replyInput>): Promise<ProductResult> {
  const parsed = replyInput.safeParse(input);
  if (!parsed.success) return { ok: false, errors: issuesToErrors(parsed.error) };
  const { db, settings } = getRuntime();
  updateProduct(db, parsed.data.productId, { mode: parsed.data.mode }, nowSeconds());
  settings.setForProduct(parsed.data.productId, 'replyPreferences', {
    includeLinks: parsed.data.includeLinks,
    dmDrafts: parsed.data.dmDrafts,
  });
  revalidatePath('/product');
  return Promise.resolve({ ok: true });
}

export async function saveProductRules(input: {
  productId: string;
  thresholds: { show: number; draft: number; notify: number } | null;
  vetoPhrases: string[];
}): Promise<ProductResult> {
  const id = productId.safeParse(input.productId);
  if (!id.success) return { ok: false, errors: { form: 'Unknown product' } };
  const { settings } = getRuntime();
  const errors: Record<string, string> = {};
  if (input.thresholds) {
    const thresholds = SETTINGS.thresholds.schema.safeParse(input.thresholds);
    if (!thresholds.success) errors.thresholds = formatIssues(thresholds.error).join(' ');
  }
  const phrases = SETTINGS.vetoPhrases.schema.safeParse(input.vetoPhrases);
  if (!phrases.success) errors.vetoPhrases = formatIssues(phrases.error).join(' ');
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (input.thresholds) settings.setForProduct(id.data, 'thresholds', input.thresholds);
  else settings.clearForProduct(id.data, 'thresholds');
  settings.setForProduct(id.data, 'vetoPhrases', input.vetoPhrases);
  revalidatePath('/product');
  return Promise.resolve({ ok: true });
}

export async function removeProduct(input: {
  productId: string;
  confirmName: string;
}): Promise<ProductResult> {
  const { db } = getRuntime();
  const product = getProduct(db, input.productId);
  if (!product)
    return Promise.resolve({ ok: false, errors: { form: 'This product no longer exists.' } });
  if (input.confirmName.trim() !== product.name) {
    return Promise.resolve({ ok: false, errors: { form: `Type ${product.name} to confirm.` } });
  }
  deleteProduct(db, product.id);
  revalidatePath('/', 'layout');
  redirect(listProducts(db).length === 0 ? '/onboarding' : '/product');
}

const ruleInput = z.object({ id: z.string().min(1).max(100), note: z.string().trim().max(200) });

/** Edits a rule learned from feedback; an empty note removes it from the rules. */
export async function saveRule(input: { id: string; note: string }): Promise<ProductResult> {
  const parsed = ruleInput.safeParse(input);
  if (!parsed.success) return { ok: false, errors: issuesToErrors(parsed.error) };
  updateFeedbackNote(getRuntime().db, parsed.data.id, parsed.data.note);
  revalidatePath('/product');
  return Promise.resolve({ ok: true });
}
