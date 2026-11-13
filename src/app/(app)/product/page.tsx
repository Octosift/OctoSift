import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { listProducts } from '@/core/db/queries/products';
import { ProductPicker } from '../../components/product-picker';
import { Button } from '../../components/ui/button';
import { Banner, PageHeader } from '../../components/ui/display';
import { getRuntime } from '../../lib/runtime';
import { DeleteProductForm, ProfileForm, RepliesForm, RulesForm } from './product-forms';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Product' };

export default async function ProductPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { db, settings } = getRuntime();
  const products = listProducts(db);
  const requested = (await searchParams).product;
  const product = products.find((candidate) => candidate.id === requested) ?? products[0];
  if (!product) return null;
  const replyPreferences = settings.getForProduct(product.id, 'replyPreferences');
  return (
    <>
      <PageHeader
        title={product.name}
        description={product.url}
        actions={
          <>
            <ProductPicker
              products={products.map(({ id, name }) => ({ id, name }))}
              value={product.id}
            />
            <Button asChild>
              <Link href="/product/new">
                <Plus aria-hidden /> Add a product
              </Link>
            </Button>
          </>
        }
      />
      <div className="flex max-w-3xl flex-col gap-6 px-6 py-6">
        {product.profile ? (
          <>
            <ProfileForm
              key={`profile-${product.id}`}
              productId={product.id}
              profile={product.profile}
            />
            <RepliesForm
              key={`replies-${product.id}`}
              productId={product.id}
              mode={product.mode}
              includeLinks={replyPreferences.includeLinks}
              dmDrafts={replyPreferences.dmDrafts}
              audience={product.profile.audience}
            />
          </>
        ) : (
          <Banner tone="danger">
            This product&apos;s profile could not be read. Delete it and add it again.
          </Banner>
        )}
        <RulesForm
          key={`rules-${product.id}`}
          productId={product.id}
          thresholds={settings.getForProduct(product.id, 'thresholds')}
          overridden={settings.isOverridden(product.id, 'thresholds')}
          vetoPhrases={settings.getForProduct(product.id, 'vetoPhrases')}
        />
        <DeleteProductForm
          key={`delete-${product.id}`}
          productId={product.id}
          name={product.name}
        />
      </div>
    </>
  );
}
