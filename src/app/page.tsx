import { redirect } from 'next/navigation';
import { listProducts } from '@/core/db/queries/products';
import { getRuntime } from './lib/runtime';

export const dynamic = 'force-dynamic';

export default function Home() {
  redirect(listProducts(getRuntime().db).length === 0 ? '/onboarding' : '/inbox');
}
