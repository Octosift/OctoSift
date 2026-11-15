import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { listProducts } from '@/core/db/queries/products';
import { subredditStats } from '@/core/db/queries/stats';
import { rulesSummaryWire } from '@/core/ai/schemas';
import { validationProgress } from '@/core/validation-queue';
import { ProductPicker } from '../../components/product-picker';
import { EmptyState, PageHeader } from '../../components/ui/display';
import { getRuntime, nowSeconds } from '../../lib/runtime';
import { AddSubredditForm, SubredditTable } from './subreddit-table';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Subreddits' };

export default async function SubredditsPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { db } = getRuntime();
  const products = listProducts(db);
  const requested = (await searchParams).product;
  const product = products.find((candidate) => candidate.id === requested) ?? products[0];
  if (!product) redirect('/product/new');
  const rows = subredditStats(db, product.id).map((row) => {
    const rules = rulesSummaryWire.safeParse(row.rulesSummary);
    return { ...row, rulesSummary: rules.success ? rules.data : null };
  });
  const progress = validationProgress(db);
  const now = nowSeconds();
  return (
    <>
      <PageHeader
        title="Subreddits"
        description="Fewer, well-chosen subreddits give better leads and cost less."
        actions={
          <ProductPicker
            products={products.map(({ id, name }) => ({ id, name }))}
            value={product.id}
          />
        }
      />
      <div className="flex flex-col gap-4 px-6 py-5">
        <AddSubredditForm productId={product.id} />
        {rows.length === 0 ? (
          <EmptyState title="No subreddits yet">
            Add the communities where people ask about the problem {product.name} solves. The app
            checks that each one exists before the next scan.
          </EmptyState>
        ) : (
          <SubredditTable
            productId={product.id}
            rows={rows}
            now={now}
            checks={progress && now - progress.requestedAt < 3600 ? progress.results : []}
          />
        )}
      </div>
    </>
  );
}
