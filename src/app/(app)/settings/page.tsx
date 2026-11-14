import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Banner, PageHeader } from '../../components/ui/display';
import { Tabs } from '../../components/ui/tabs';
import { nowSeconds } from '../../lib/runtime';
import { loadSettings } from '../../lib/data/settings';
import { AiSection } from './ai-section';
import { EvergreenSection, NotificationsSection, RedditSection } from './connection-sections';
import { DataSection } from './data-section';
import { DataSourceSection } from './data-source';
import { RedditAccountCard } from './reddit-account';
import { BudgetSection, FiltersSection, PricesSection } from './sections';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  const data = loadSettings();
  const panel = (children: ReactNode) => (
    <div className="flex max-w-3xl flex-col gap-6">{children}</div>
  );
  return (
    <>
      <PageHeader title="Settings" description="Providers, spending, Reddit and your data." />
      {data.demo ? (
        <div className="px-6 pb-4">
          <Banner className="max-w-3xl">
            Demo mode: the AI provider, Reddit and DataForSEO are simulated, so no key is needed.
            Changes here are saved to the demo database only.
          </Banner>
        </div>
      ) : null}
      <Tabs
        label="Settings sections"
        panelClassName="px-6 py-6"
        items={[
          { id: 'ai', label: 'AI', content: panel(<AiSection data={data} />) },
          {
            id: 'budget',
            label: 'Budget & schedule',
            anchors: ['prices'],
            content: panel(
              <>
                <BudgetSection data={data} />
                <PricesSection data={data} />
              </>,
            ),
          },
          {
            id: 'reddit',
            label: 'Reddit',
            anchors: ['reddit-reading', 'data-source'],
            content: panel(
              <>
                <RedditAccountCard account={data.account} now={nowSeconds()} demo={data.demo} />
                <DataSourceSection data={data} />
                <RedditSection data={data} />
              </>,
            ),
          },
          { id: 'filters', label: 'Filters', content: panel(<FiltersSection data={data} />) },
          {
            id: 'notifications',
            label: 'Notifications',
            content: panel(<NotificationsSection data={data} />),
          },
          { id: 'evergreen', label: 'Evergreen', content: panel(<EvergreenSection data={data} />) },
          { id: 'data', label: 'Data', content: panel(<DataSection />) },
        ]}
      />
    </>
  );
}
