import 'server-only';
import { z } from 'zod';
import { INTENTS } from '@/core/ai/schemas';
import { CONFIG } from '@/core/config';
import {
  countByTab,
  INBOX_TABS,
  inboxSubreddits,
  leadDetail,
  listLeads,
  type InboxFilters,
  type InboxTab,
} from '@/core/db/queries/inbox';
import { listProducts } from '@/core/db/queries/products';
import { pacingWarnings, PACING_REASON, recentReplies } from '@/core/guard/pacing';
import { getRuntime, nowSeconds } from '../runtime';
import { evergreenCount } from './evergreen';

const optionalText = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => (value === '' ? undefined : value));
const optionalNumber = z.coerce.number().int().min(0).max(100_000).optional().catch(undefined);

export const inboxParamsSchema = z.object({
  tab: z.enum([...INBOX_TABS, 'evergreen']).catch('todo'),
  lead: optionalText.catch(undefined),
  product: optionalText.catch(undefined),
  subreddit: optionalText.catch(undefined),
  intent: z.enum(INTENTS).optional().catch(undefined),
  min: optionalNumber,
  age: optionalNumber,
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type InboxParams = z.output<typeof inboxParamsSchema>;

export function parseInboxParams(raw: Record<string, string | string[] | undefined>): InboxParams {
  const flat = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  return inboxParamsSchema.parse(flat);
}

/** The lead tabs; the Evergreen tab has its own loader. */
export function loadInbox(params: InboxParams & { tab: InboxTab }) {
  const { db } = getRuntime();
  const now = nowSeconds();
  const filters: InboxFilters = {
    tab: params.tab,
    productId: params.product,
    subreddit: params.subreddit,
    intent: params.intent,
    minScore: params.min,
    maxAgeHours: params.age,
  };
  const pageSize = CONFIG.inbox.pageSize;
  const list = listLeads(db, filters, {
    limit: pageSize,
    offset: (params.page - 1) * pageSize,
    now,
  });
  const selectedId = params.lead ?? list.rows[0]?.id;
  const detail = selectedId ? leadDetail(db, selectedId) : null;
  const mentions = detail?.reply?.mentionsProduct ?? false;
  const pacing =
    detail && detail.lead.status !== 'replied'
      ? pacingWarnings({
          replies: recentReplies(db, now - CONFIG.pacing.helpfulPerMentionWindowDays * 86_400),
          subreddit: detail.post.subreddit,
          mentionsProduct: mentions,
          now,
        })
      : [];
  return {
    now,
    params,
    rows: list.rows,
    total: list.total,
    pageSize,
    counts: countByTab(db, params.product),
    evergreen: evergreenCount(params.product),
    products: listProducts(db).map((product) => ({ id: product.id, name: product.name })),
    subreddits: inboxSubreddits(db, params.product),
    detail,
    pacing: pacing.length > 0 ? { warnings: pacing, reason: PACING_REASON } : null,
  };
}

export type InboxData = ReturnType<typeof loadInbox>;
