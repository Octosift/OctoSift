/**
 * The final lead score: the model's score, discounted for age and lowered
 * for risk flags. All weights live in the config.
 */
import { CONFIG } from '../config';

export function freshnessFactor(ageHours: number): number {
  const tier = CONFIG.score.freshness.find((entry) => ageHours < entry.maxAgeHours);
  return tier?.factor ?? 0.5;
}

export function flagPenalty(flags: readonly string[]): number {
  const penalties: Readonly<Record<string, number>> = CONFIG.score.flagPenalties;
  return [...new Set(flags)].reduce((total, flag) => total + (penalties[flag] ?? 0), 0);
}

export function finalScore(input: {
  modelScore: number;
  ageHours: number;
  flags: readonly string[];
}): number {
  const raw = input.modelScore * freshnessFactor(input.ageHours) - flagPenalty(input.flags);
  return Math.min(100, Math.max(0, Math.round(raw)));
}
