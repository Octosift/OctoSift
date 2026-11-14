/**
 * Subreddit suggestions are one AI call, and a slow one on some providers.
 * The answer is kept per product until its profile changes, and a call that
 * is already running is shared, so a page that loads twice (React does so in
 * development) or a reload asks the model once.
 */
import type { Db } from '../db/client';
import { readState, writeState } from '../state';
import type { SuggestResult } from './subreddits';

type Suggestions = Extract<SuggestResult, { ok: true }>['suggestions'];

const holder = globalThis as typeof globalThis & {
  subredditSuggestionCalls?: Map<string, Promise<SuggestResult>>;
};

function running(): Map<string, Promise<SuggestResult>> {
  holder.subredditSuggestionCalls ??= new Map();
  return holder.subredditSuggestionCalls;
}

/** The stored answer for this product and profile version, if any. */
export function cachedSuggestions(
  db: Db,
  productId: string,
  profileAt: number,
): Suggestions | null {
  const stored = readState(db, 'state.subredditSuggestions');
  return stored?.productId === productId && stored.profileAt === profileAt
    ? stored.suggestions
    : null;
}

export async function suggestOnce(
  db: Db,
  product: { id: string; updatedAt: number },
  ask: () => Promise<SuggestResult>,
): Promise<SuggestResult> {
  const cached = cachedSuggestions(db, product.id, product.updatedAt);
  if (cached) return { ok: true, suggestions: cached };
  const key = `${product.id}:${String(product.updatedAt)}`;
  const calls = running();
  const existing = calls.get(key);
  if (existing) return existing;
  const call = ask()
    .then((result) => {
      if (result.ok) {
        writeState(db, 'state.subredditSuggestions', {
          productId: product.id,
          profileAt: product.updatedAt,
          suggestions: result.suggestions,
        });
      }
      return result;
    })
    .finally(() => {
      calls.delete(key);
    });
  calls.set(key, call);
  return call;
}
