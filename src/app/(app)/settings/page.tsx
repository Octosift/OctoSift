import type { Metadata } from 'next';
import { Banner, PageHeader } from '../../components/ui/display';
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

const SECTIONS = [
  ['ai', 'AI'],
  ['prices', 'Prices'],
  ['budget', 'Budget'],
  ['filters', 'Filters'],
  ['reddit', 'Reddit'],
  ['data-source', 'Data source'],
  ['notifications', 'Notifications'],
  ['evergreen', 'Evergreen'],
  ['data', 'Data'],
] as const;

export default function SettingsPage() {
  const data = loadSettings();
  return (
    <>
      <PageHeader
        title="Settings"
        description="Providers, budgets, schedule and everything else."
      />
      <div className="flex gap-8 px-6 py-6">
        <nav
          aria-label="Settings sections"
          className="sticky top-6 hidden h-fit w-36 shrink-0 flex-col gap-1 xl:flex"
        >
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex max-w-3xl min-w-0 flex-1 flex-col gap-6">
          {data.demo ? (
            <Banner>
              Demo mode: the AI provider, Reddit and DataForSEO are simulated, so no key is needed.
              Changes here are saved to the demo database only.
            </Banner>
          ) : null}
          <AiSection data={data} />
          <PricesSection data={data} />
          <BudgetSection data={data} />
          <FiltersSection data={data} />
          <RedditAccountCard account={data.account} now={nowSeconds()} demo={data.demo} />
          <DataSourceSection data={data} />
          <RedditSection data={data} />
          <NotificationsSection data={data} />
          <EvergreenSection data={data} />
          <DataSection />
        </div>
      </div>
    </>
  );
}
