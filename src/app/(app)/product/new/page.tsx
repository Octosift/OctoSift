import type { Metadata } from 'next';
import { PageHeader } from '../../../components/ui/display';
import { getRuntime } from '../../../lib/runtime';
import { StepProduct } from '../../../onboarding/step-product';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Add a product' };

export default function NewProductPage() {
  return (
    <>
      <PageHeader
        title="Add a product"
        description="Each product has its own profile, subreddits and leads."
      />
      <div className="max-w-3xl px-6 py-6">
        <StepProduct existing={null} demo={getRuntime().env.DEMO_MODE} afterCreate="subreddits" />
      </div>
    </>
  );
}
