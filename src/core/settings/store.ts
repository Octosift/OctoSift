/**
 * Typed access to settings. Reads never fail: a missing or no-longer-valid
 * stored value yields the default. Writes are validated and return readable
 * errors instead of throwing.
 */
import type { z } from 'zod';
import type { Db } from '../db/client';
import { deleteSetting, readSetting, writeSetting } from '../db/queries/settings';
import {
  SETTINGS,
  type ProductSettingKey,
  type SettingInput,
  type SettingKey,
  type SettingValue,
} from './registry';

export type SetResult = { ok: true } | { ok: false; errors: string[] };

export interface SettingsStore {
  get<K extends SettingKey>(key: K): SettingValue<K>;
  set<K extends SettingKey>(key: K, value: SettingInput<K>): SetResult;
  getForProduct<K extends ProductSettingKey>(productId: string, key: K): SettingValue<K>;
  setForProduct<K extends ProductSettingKey>(
    productId: string,
    key: K,
    value: SettingInput<K>,
  ): SetResult;
  clearForProduct(productId: string, key: ProductSettingKey): void;
  /** Whether the product has its own value rather than the global one. */
  isOverridden(productId: string, key: ProductSettingKey): boolean;
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
  );
}

function productKey(productId: string, key: ProductSettingKey): string {
  return `product:${productId}:${key}`;
}

export function createSettingsStore(db: Db): SettingsStore {
  function parseStored<K extends SettingKey>(
    storageKey: string,
    key: K,
  ): SettingValue<K> | undefined {
    const stored = readSetting(db, storageKey);
    if (!stored.found) return undefined;
    const parsed = SETTINGS[key].schema.safeParse(stored.value);
    return parsed.success ? (parsed.data as SettingValue<K>) : undefined;
  }

  function validateAndWrite<K extends SettingKey>(
    storageKey: string,
    key: K,
    value: SettingInput<K>,
  ): SetResult {
    const parsed = SETTINGS[key].schema.safeParse(value);
    if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error) };
    writeSetting(db, storageKey, parsed.data);
    return { ok: true };
  }

  function get<K extends SettingKey>(key: K): SettingValue<K> {
    return parseStored(key, key) ?? (SETTINGS[key].defaultValue as SettingValue<K>);
  }

  return {
    get,
    set: (key, value) => validateAndWrite(key, key, value),
    getForProduct: (productId, key) => parseStored(productKey(productId, key), key) ?? get(key),
    setForProduct: (productId, key, value) =>
      validateAndWrite(productKey(productId, key), key, value),
    clearForProduct: (productId, key) => {
      deleteSetting(db, productKey(productId, key));
    },
    isOverridden: (productId, key) => readSetting(db, productKey(productId, key)).found,
  };
}
