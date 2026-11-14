/**
 * The model ids a saved key can use, kept so the presets and model lists can
 * be shown without asking the provider on every page load. Lists are
 * refreshed when a key is saved and on request.
 */
import type { Db } from '../db/client';
import { clearState, readState, writeState } from '../state';
import type { ProviderId } from './types';

/** OpenAI lists every model the key can reach; these are not text models. */
const NOT_TEXT =
  /embed|tts|whisper|dall-e|image|audio|realtime|transcribe|moderation|search|davinci|babbage|live/i;

/** Keeps the ids that can answer text prompts, sorted. */
export function textModels(provider: ProviderId, models: readonly string[]): string[] {
  const unique = [...new Set(models)];
  const kept = provider === 'openai' ? unique.filter((id) => !NOT_TEXT.test(id)) : unique;
  return kept.sort();
}

export function storedModelList(db: Db, provider: ProviderId): string[] | null {
  return readState(db, 'state.modelLists')?.[provider]?.models ?? null;
}

export function storeModelList(
  db: Db,
  provider: ProviderId,
  models: readonly string[],
  now: number,
): string[] {
  const lists = readState(db, 'state.modelLists') ?? {};
  const kept = textModels(provider, models);
  writeState(db, 'state.modelLists', { ...lists, [provider]: { models: kept, fetchedAt: now } });
  return kept;
}

/** Forgets a provider's list, for example when its key is removed. */
export function forgetModelList(db: Db, provider: ProviderId): void {
  const lists = readState(db, 'state.modelLists');
  if (!lists?.[provider]) return;
  const rest = Object.fromEntries(Object.entries(lists).filter(([key]) => key !== provider));
  if (Object.keys(rest).length === 0) clearState(db, 'state.modelLists');
  else writeState(db, 'state.modelLists', rest);
}
