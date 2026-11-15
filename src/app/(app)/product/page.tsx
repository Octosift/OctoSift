import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { feedbackRules } from '@/core/db/queries/feedback';
import { listProducts } from '@/core/db/queries/products';
import { ProductPicker } from '../../components/product-picker';
import { Button } from '../../components/ui/button';
import { Banner, PageHeader } from '../../components/ui/display';
import { Tabs } from '../../components/ui/tabs';
import { getRuntime } from '../../lib/runtime';
import { ProfileForm, RepliesForm } from './product-forms';
import { DeleteProductForm, RulesForm } from './product-rules';
import { RulesEditor } from './rules-editor';

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
  if (!product) redirect('/product/new');
  const replyPreferences = settings.getForProduct(product.id, 'replyPreferences');
  const rules = feedbackRules(db, product.id);
  const panel = (children: ReactNode) => (
    <div className="flex max-w-3xl flex-col gap-6">{children}</div>
  );
  const broken = (
    <Banner tone="danger">
      This product&apos;s profile could not be read. Delete it and add it again.
    </Banner>
  );
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
      <Tabs
        key={product.id}
        label="Product sections"
        panelClassName="px-6 py-6"
        items={[
          {
            id: 'profile',
            label: 'Profile',
            content: panel(
              <>
                {product.profile ? (
                  <ProfileForm
                    key={`profile-${product.id}`}
                    productId={product.id}
                    profile={product.profile}
                  />
                ) : (
                  broken
                )}
                <DeleteProductForm
                  key={`delete-${product.id}`}
                  productId={product.id}
                  name={product.name}
                />
              </>,
            ),
          },
          {
            id: 'replies',
            label: 'Replies',
            content: panel(
              product.profile ? (
                <RepliesForm
                  key={`replies-${product.id}`}
                  productId={product.id}
                  mode={product.mode}
                  includeLinks={replyPreferences.includeLinks}
                  dmDrafts={replyPreferences.dmDrafts}
                  length={replyPreferences.length}
                  audience={product.profile.audience}
                />
              ) : (
                broken
              ),
            ),
          },
          {
            id: 'rules',
            label: 'Lead rules',
            content: panel(
              <RulesForm
                key={`rules-${product.id}`}
                productId={product.id}
                thresholds={settings.getForProduct(product.id, 'thresholds')}
                overridden={settings.isOverridden(product.id, 'thresholds')}
                vetoPhrases={settings.getForProduct(product.id, 'vetoPhrases')}
              />,
            ),
          },
          {
            id: 'feedback',
            label: 'Your feedback',
            ...(rules.length > 0
              ? {
                  badge: (
                    <span className="rounded-md bg-muted px-1.5 text-xs text-muted-foreground tabular">
                      {rules.length}
                    </span>
                  ),
                }
              : {}),
            content: panel(<RulesEditor rules={rules} />),
          },
        ]}
      />
    </>
  );
}
