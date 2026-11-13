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
  'state.scanRequest': z.object({ requestedAt: z.number(), productId: z.string().nullable() }),
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
