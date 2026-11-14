import { redirect } from 'next/navigation';
import { listProducts } from '@/core/db/queries/products';
import { getRuntime } from './lib/runtime';

export const dynamic = 'force-dynamic';

export default function Home() {
  const { db, settings } = getRuntime();
  // A finished or skipped onboarding opens the dashboard even without a product.
  const fresh = listProducts(db).length === 0 && !settings.get('onboarding.completed');
  redirect(fresh ? '/onboarding' : '/inbox');
}
