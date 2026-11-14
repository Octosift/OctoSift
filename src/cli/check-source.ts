/**
 * `pnpm cli check-source [subreddit]`: one feed request with the configured
 * data source, to see whether it works before relying on it. Prints which
 * source answered, the result and the number of posts.
 */
import { z } from 'zod';
import type { RedditSource } from '../core/reddit/types';

export const CHECK_SOURCE_USAGE = `check-source [subreddit]
  Make one feed request with the configured data source and print the result.
  Uses the first watched subreddit when none is given.
`;

const NAMES: Readonly<Record<string, string>> = {
  session: 'Reddit account',
  provider: 'data provider',
  rss: 'public RSS feeds',
  demo: 'demo source',
};

export function parseCheckSourceArgs(
  args: string[],
): { ok: true; subreddit: string | null } | { ok: false; message: string } {
  if (args.length > 1) return { ok: false, message: CHECK_SOURCE_USAGE };
  const raw = args[0];
  if (raw === undefined) return { ok: true, subreddit: null };
  const name = raw.replace(/^\/?r\//i, '').toLowerCase();
  return z
    .string()
    .regex(/^[a-z0-9_]{2,21}$/)
    .safeParse(name).success
    ? { ok: true, subreddit: name }
    : { ok: false, message: `"${raw}" is not a subreddit name.\n\n${CHECK_SOURCE_USAGE}` };
}

export async function runCheckSource(
  deps: {
    source: RedditSource & { active?: () => string | null };
    watched: string[];
    now: number;
    /** Names the source when it is not a chain, as in demo mode. */
    fallbackId?: string;
  },
  subreddit: string | null,
): Promise<{ code: number; output: string }> {
  const name = subreddit ?? deps.watched[0] ?? null;
  if (name === null) {
    return {
      code: 2,
      output: 'No subreddit to read. Add one, or pass a name: check-source freelance\n',
    };
  }
  const before = deps.source.active?.() ?? deps.fallbackId ?? null;
  const result = await deps.source.fetchNewPosts([name], { limit: 25, maxPages: 1 });
  const after = deps.source.active?.() ?? before;
  const lines: string[] = [];
  const label = (id: string | null) => (id ? (NAMES[id] ?? id) : 'none set up');
  lines.push(
    `Source: ${label(after)}${before !== after ? ` (after ${label(before)} failed)` : ''}`,
  );
  if (!result.ok) {
    lines.push(`r/${name}: failed (${result.kind})${result.message ? `: ${result.message}` : ''}`);
    return { code: 1, output: `${lines.join('\n')}\n` };
  }
  const newest = result.posts[0];
  const age = newest ? Math.max(0, Math.round((deps.now - newest.createdAt) / 60)) : null;
  lines.push(
    `r/${name}: ok, ${String(result.posts.length)} posts${age === null ? '' : `, newest ${String(age)} minutes old`}`,
  );
  return { code: 0, output: `${lines.join('\n')}\n` };
}
