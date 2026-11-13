import type { Metadata } from 'next';
import { loadInbox, parseInboxParams } from '../../lib/data/inbox';
import { InboxView } from './inbox-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Inbox' };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const data = loadInbox(parseInboxParams(await searchParams));
  return <InboxView data={data} />;
}
