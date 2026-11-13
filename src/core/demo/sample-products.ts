/** Loads the three fictional sample products used by tests and demo mode. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildShortProfile } from '../profile/extract';
import { productProfileSchema, type ProductProfile } from '../profile/types';

export const SAMPLE_PRODUCT_SLUGS = ['acme-invoices', 'acme-plants', 'acme-logs'] as const;
export type SampleProductSlug = (typeof SAMPLE_PRODUCT_SLUGS)[number];

const FIXTURES = resolve(process.cwd(), 'fixtures/products');

export function loadSampleProduct(slug: SampleProductSlug): ProductProfile {
  const raw: unknown = JSON.parse(readFileSync(resolve(FIXTURES, `${slug}.json`), 'utf8'));
  const profile = productProfileSchema.parse({ ...(raw as object), short: '' });
  return { ...profile, short: buildShortProfile(profile) };
}

export function loadSampleProducts(): Record<SampleProductSlug, ProductProfile> {
  return {
    'acme-invoices': loadSampleProduct('acme-invoices'),
    'acme-plants': loadSampleProduct('acme-plants'),
    'acme-logs': loadSampleProduct('acme-logs'),
  };
}
