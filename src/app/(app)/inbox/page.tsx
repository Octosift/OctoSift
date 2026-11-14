import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '../../components/ui/button';
import { EmptyState, PageHeader } from '../../components/ui/display';
import { loadEvergreen } from '../../lib/data/evergreen';
import { loadInbox, parseInboxParams } from '../../lib/data/inbox';
import { EvergreenView } from './evergreen-view';
import { InboxView } from './inbox-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Inbox' };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseInboxParams(await searchParams);
  const data = loadInbox({ ...params, tab: params.tab === 'evergreen' ? 'todo' : params.tab });
  if (data.products.length === 0) {
    return (
      <>
        <PageHeader title="Inbox" />
        <EmptyState
          title="Add your product to start"
          action={
            <Button asChild variant="primary">
              <Link href="/product/new">Add a product</Link>
            </Button>
          }
        >
          Leads appear here once the app knows what you built and which subreddits to read.
        </EmptyState>
      </>
    );
  }
  if (params.tab === 'evergreen') {
    const evergreen = loadEvergreen(params.product);
    if (evergreen) return <EvergreenView data={evergreen} />;
  }
  // Without DataForSEO the Evergreen tab does not exist; fall back to To do.
  return <InboxView data={data} />;
}
