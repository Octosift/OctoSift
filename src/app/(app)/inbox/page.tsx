import type { Metadata } from 'next';
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
  if (params.tab === 'evergreen') {
    const evergreen = loadEvergreen(params.product);
    if (evergreen) return <EvergreenView data={evergreen} />;
  }
  // Without DataForSEO the Evergreen tab does not exist; fall back to To do.
  const tab = params.tab === 'evergreen' ? 'todo' : params.tab;
  return <InboxView data={loadInbox({ ...params, tab })} />;
}
