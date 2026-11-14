/**
 * Chooses which way of reading Reddit a scan uses, and falls back.
 *
 * The user's preferred source comes first, then the others in a fixed order:
 * the connected session, then public RSS. Sources that are not set up are
 * left out. With failover on, a source whose account stops working, or that
 * Reddit blocks, hands the rest of the scan to the next one, and the switch
 * is reported so the dashboard can explain it.
 */
import type { FetchOptions, FetchResult, RedditSource } from './types';

export const SOURCE_IDS = ['session', 'rss'] as const;
export type SourceId = (typeof SOURCE_IDS)[number] | 'demo';

export interface SourceCandidate {
  id: SourceId;
  source: RedditSource;
}

export interface SourceChain extends RedditSource {
  /** The source the next request goes to, or null when none is left. */
  active(): SourceId | null;
}

/** The order to try sources in: the preferred one, then the rest in the default order. */
export function sourceOrder(preferred: SourceId): SourceId[] {
  return [preferred, ...SOURCE_IDS.filter((id) => id !== preferred)];
}

export function createSourceChain(
  candidates: readonly SourceCandidate[],
  options: {
    failover: boolean;
    onFailover?: (from: SourceId, to: SourceId | null, reason: string) => void;
    /** Called when the preferred source answers, so an old failover notice can go. */
    onPreferredWorks?: () => void;
  },
): SourceChain {
  let index = 0;
  const current = () => candidates[index] ?? null;

  return {
    get maxSubredditsPerRequest() {
      return current()?.source.maxSubredditsPerRequest;
    },
    active: () => current()?.id ?? null,

    async fetchNewPosts(subreddits: string[], opts: FetchOptions): Promise<FetchResult> {
      for (;;) {
        const candidate = current();
        if (!candidate) {
          return { ok: false, kind: 'auth', message: 'No way of reading Reddit is set up' };
        }
        const result = await candidate.source.fetchNewPosts(subreddits, opts);
        if (result.ok && index === 0) options.onPreferredWorks?.();
        const fatal = !result.ok && (result.kind === 'auth' || result.kind === 'blocked');
        if (result.ok || !fatal || !options.failover) return result;
        index += 1;
        options.onFailover?.(candidate.id, current()?.id ?? null, result.message ?? result.kind);
        // With nothing left to try, the last source's own failure says the most.
        if (!current()) return result;
      }
    },
  };
}
