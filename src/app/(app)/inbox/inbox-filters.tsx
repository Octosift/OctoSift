'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Select } from '../../components/ui/fields';
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
  const select = 'h-7 w-full min-w-0 text-xs sm:w-auto sm:max-w-44';
  return (
    <div
      className="grid grid-cols-2 gap-1.5 border-b border-border px-3 py-2 sm:flex sm:flex-wrap"
      role="group"
      aria-label="Filters"
    >
      {products.length > 1 ? (
        <Select
          aria-label="Product"
          className={select}
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
        className={select}
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
        className={select}
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
        className={select}
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
        className={select}
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
    </div>
  );
}
