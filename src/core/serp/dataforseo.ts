/**
 * Google organic results from DataForSEO, used to find Reddit threads that
 * rank for a buyer's search. One live request per keyword, United States,
 * English, top 20 results. The cost DataForSEO reports is returned as is.
 *
 * Optional: nothing calls this until the user saves DataForSEO credentials.
 */
import { z } from 'zod';
import { CONFIG } from '../config';

export const DATAFORSEO_ENDPOINT =
  'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

export interface SerpCredentials {
  login: string;
  password: string;
}

export interface SerpItem {
  /** Position among the organic results, starting at 1. */
  rank: number;
  url: string;
  title: string;
  /** When Google shows a date for the page, in epoch seconds. */
  publishedAt: number | null;
}

export type SerpFailureKind = 'auth' | 'funds' | 'rate_limited' | 'error';

export type SerpResponse =
  | { ok: true; items: SerpItem[]; costUsd: number }
  | { ok: false; kind: SerpFailureKind; message: string; costUsd: number };

/** Looks up one keyword; the evergreen check depends on this rather than on HTTP. */
export type SerpFetcher = (keyword: string) => Promise<SerpResponse>;

const OK = 20_000;
const NO_RESULTS = 40_102;

const organicItem = z.object({
  type: z.literal('organic'),
  rank_group: z.number().int().positive(),
  url: z.string().min(1),
  title: z.string().nullish(),
  timestamp: z.string().nullish(),
});

const responseSchema = z.object({
  status_code: z.number(),
  status_message: z.string().catch(''),
  cost: z.number().catch(0),
  tasks: z
    .array(
      z.object({
        status_code: z.number(),
        status_message: z.string().catch(''),
        result: z
          .array(z.object({ items: z.array(z.unknown()).nullish() }))
          .nullish()
          .catch(null),
      }),
    )
    .catch([]),
});

const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})[:-](\d{2})[:-](\d{2})\s*(?:([+-])(\d{2}):?(\d{2}))?/;

/** Parses DataForSEO's "2025-03-02 12:57:46 +00:00" into epoch seconds. */
export function parseSerpTimestamp(raw: string | null | undefined): number | null {
  const match = raw?.trim().match(TIMESTAMP);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = match;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (Number.isNaN(utc)) return null;
  const offsetMin = sign ? (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om)) : 0;
  return Math.floor(utc / 1000) - offsetMin * 60;
}

function failureKind(code: number): SerpFailureKind {
  if (code === 40_100 || code === 40_101) return 'auth';
  if (code === 40_200 || code === 40_210 || code === 40_203) return 'funds';
  if (code === 40_202 || code === 40_209) return 'rate_limited';
  return 'error';
}

function httpFailure(status: number): SerpResponse {
  const kind: SerpFailureKind =
    status === 401 || status === 403
      ? 'auth'
      : status === 402
        ? 'funds'
        : status === 429
          ? 'rate_limited'
          : 'error';
  return { ok: false, kind, message: `DataForSEO answered HTTP ${String(status)}`, costUsd: 0 };
}

export function createDataForSeoFetcher(
  credentials: SerpCredentials,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): SerpFetcher {
  const { fetchImpl = fetch, timeoutMs = CONFIG.serp.timeoutMs } = options;
  const auth = Buffer.from(`${credentials.login}:${credentials.password}`).toString('base64');

  return async (keyword) => {
    let response: Response;
    try {
      response = await fetchImpl(DATAFORSEO_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            keyword,
            location_code: CONFIG.serp.locationCode,
            language_code: CONFIG.serp.languageCode,
            device: 'desktop',
            depth: CONFIG.serp.depth,
          },
        ]),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'TimeoutError'
          ? 'DataForSEO did not answer in time'
          : 'Could not reach DataForSEO';
      return { ok: false, kind: 'error', message, costUsd: 0 };
    }
    if (!response.ok) return httpFailure(response.status);

    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      return {
        ok: false,
        kind: 'error',
        message: 'DataForSEO sent an unexpected answer',
        costUsd: 0,
      };
    }
    const body = parsed.data;
    const task = body.tasks[0];
    const code = body.status_code !== OK ? body.status_code : (task?.status_code ?? OK);
    if (code === NO_RESULTS) return { ok: true, items: [], costUsd: body.cost };
    if (code !== OK) {
      const message = body.status_code !== OK ? body.status_message : (task?.status_message ?? '');
      return {
        ok: false,
        kind: failureKind(code),
        message: `DataForSEO: ${message || `status ${String(code)}`}`,
        costUsd: body.cost,
      };
    }
    const items: SerpItem[] = [];
    for (const raw of task?.result?.[0]?.items ?? []) {
      const item = organicItem.safeParse(raw);
      if (!item.success) continue;
      items.push({
        rank: item.data.rank_group,
        url: item.data.url,
        title: item.data.title ?? '',
        publishedAt: parseSerpTimestamp(item.data.timestamp),
      });
    }
    return { ok: true, items, costUsd: body.cost };
  };
}
