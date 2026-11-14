/**
 * Internal state shared between processes through the settings table: when
 * Reddit reads may resume after a block, the scan lock, and pending "scan
 * now" requests. These are not user settings, so they live outside the
 * settings registry, but they are validated the same way.
 */
import { z } from 'zod';
import type { Db } from './db/client';
import { deleteSetting, readSetting, writeSetting } from './db/queries/settings';

const STATE = {
  'state.redditPausedUntil': z.number(),
  'state.scanLock': z.object({ owner: z.string(), heartbeatAt: z.number() }),
  /** The last time a scan had to leave the preferred source, and why. */
  'state.sourceFailover': z.object({
    from: z.string(),
    to: z.string().nullable(),
    reason: z.string(),
    at: z.number(),
  }),
  /** The connected Reddit account: whose it is, and whether Reddit still accepts it. */
  'state.redditSession': z.object({
    status: z.enum(['connected', 'needs_reauth']),
    username: z.string().nullable(),
    at: z.number(),
    reason: z.string().nullable(),
  }),
  /** The last daily check of the connected account's public profile. */
  'state.accountCheck': z.object({
    username: z.string().nullable(),
    status: z.enum(['visible', 'suspended', 'missing']).nullable(),
    /** True once a bad status was seen twice in a row, half an hour apart. */
    confirmed: z.boolean(),
    checkedAt: z.number(),
    nextAt: z.number(),
  }),
  /** Model ids each provider offered the saved key, for the model lists and presets. */
  'state.modelLists': z.record(
    z.string(),
    z.object({ models: z.array(z.string()), fetchedAt: z.number() }),
  ),
  /** The last subreddit suggestions, kept until the product's profile changes. */
  'state.subredditSuggestions': z.object({
    productId: z.string(),
    profileAt: z.number(),
    suggestions: z.array(
      z.object({
        name: z.string(),
        reason: z.string(),
        promotionStrictness: z.enum(['lenient', 'moderate', 'strict', 'unknown']),
      }),
    ),
  }),
  'state.scanRequest': z.object({ requestedAt: z.number(), productId: z.string().nullable() }),
  'state.validationRequest': z.object({ requestedAt: z.number(), names: z.array(z.string()) }),
  'state.validationProgress': z.object({
    requestedAt: z.number(),
    total: z.number(),
    done: z.boolean(),
    results: z.array(
      z.object({
        name: z.string(),
        status: z.enum(['ok', 'gone', 'unavailable']),
        postsPerDay: z.number().optional(),
        message: z.string().optional(),
      }),
    ),
  }),
} as const;

export type StateKey = keyof typeof STATE;
export type StateValue<K extends StateKey> = z.output<(typeof STATE)[K]>;

export function readState<K extends StateKey>(db: Db, key: K): StateValue<K> | null {
  const stored = readSetting(db, key);
  if (!stored.found) return null;
  const parsed = STATE[key].safeParse(stored.value);
  return parsed.success ? (parsed.data as StateValue<K>) : null;
}

export function writeState<K extends StateKey>(db: Db, key: K, value: StateValue<K>): void {
  writeSetting(db, key, STATE[key].parse(value));
}

export function clearState(db: Db, key: StateKey): void {
  deleteSetting(db, key);
}
