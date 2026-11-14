/**
 * Applying a preset: the four stage models, plus prices for those models in
 * the price table so the Runs screen and the budget caps know their cost.
 * Prices the user already entered are kept.
 */
import type { SettingsStore } from '../settings/store';
import { presetPrices, presetStages, type PresetId, type PresetProvider } from './presets';

export function applyPreset(
  settings: SettingsStore,
  provider: PresetProvider,
  preset: PresetId,
): void {
  settings.set('ai.stages', presetStages(provider, preset));
  const prices = settings.get('ai.prices');
  const missing = Object.fromEntries(
    Object.entries(presetPrices(provider, preset)).filter(([key]) => !(key in prices)),
  );
  if (Object.keys(missing).length > 0) settings.set('ai.prices', { ...prices, ...missing });
}
