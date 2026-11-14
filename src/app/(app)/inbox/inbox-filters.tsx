'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Select } from '../../components/ui/fields';
import { cn } from '../../components/ui/utils';
import { INTENT_LABELS } from '../../lib/text';
import { inboxHref } from './url';

interface Props {
  products: { id: string; name: string }[];
  subreddits: string[];
  values: { product?: string; subreddit?: string; intent?: string; min?: number; age?: number };
}

/** Filters live in the URL, so a filtered inbox can be bookmarked and shared locally. */
export function InboxFilters({ products, subreddits, values }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const set = (key: string, value: string) => {
    router.push(inboxHref(searchParams, { [key]: value, lead: null, page: null }));
  };
  /** Compact chips; a chip with a value set is tinted so active filters stand out. */
  const chip = (value: unknown) =>
    cn(
      'field-sizing-content h-7 w-auto max-w-44 min-w-0 rounded-md border-transparent bg-muted pr-7 pl-2.5 text-xs shadow-none hover:border-transparent hover:bg-muted/70',
      value !== undefined &&
        'bg-brand-subtle font-medium text-brand-subtle-foreground hover:bg-brand-subtle',
    );
  const active = Object.keys(values).length > 0;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5"
      role="group"
      aria-label="Filters"
    >
      {products.length > 1 ? (
        <Select
          aria-label="Product"
          className={chip(values.product)}
          value={values.product ?? ''}
          onChange={(event) => {
            set('product', event.target.value);
          }}
        >
          <option value="">All products</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Select
        aria-label="Subreddit"
        className={chip(values.subreddit)}
        value={values.subreddit ?? ''}
        onChange={(event) => {
          set('subreddit', event.target.value);
        }}
      >
        <option value="">All subreddits</option>
        {subreddits.map((name) => (
          <option key={name} value={name}>
            r/{name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Intent"
        className={chip(values.intent)}
        value={values.intent ?? ''}
        onChange={(event) => {
          set('intent', event.target.value);
        }}
      >
        <option value="">Any intent</option>
        {Object.entries(INTENT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Minimum score"
        className={chip(values.min)}
        value={values.min?.toString() ?? ''}
        onChange={(event) => {
          set('min', event.target.value);
        }}
      >
        <option value="">Any score</option>
        <option value="75">75 and up</option>
        <option value="85">85 and up</option>
      </Select>
      <Select
        aria-label="Post age"
        className={chip(values.age)}
        value={values.age?.toString() ?? ''}
        onChange={(event) => {
          set('age', event.target.value);
        }}
      >
        <option value="">Any age</option>
        <option value="6">Last 6 hours</option>
        <option value="24">Last 24 hours</option>
        <option value="48">Last 2 days</option>
      </Select>
      {active ? (
        <Link
          href={inboxHref({}, { tab: searchParams.get('tab') ?? undefined })}
          className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Clear
        </Link>
      ) : null}
    </div>
  );
}
