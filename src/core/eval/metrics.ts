/** Scoring for the golden-set evaluation: precision, recall, confusion, worst misses. */
import { FITS, type Fit } from '../ai/schemas';
import { labelScore, type GoldenLabel } from './golden';

export interface EvalCase {
  product: string;
  id: string;
  title: string;
  label: GoldenLabel;
  triageRelevant: boolean | null;
  /** Null when the post was not qualified (screened out, failed, or budget reached). */
  fit: Fit | null;
  score: number | null;
  reason: string;
  predictedLead: boolean;
  expectedLead: boolean;
}

export interface Rate {
  value: number | null;
  numerator: number;
  denominator: number;
}

function rate(numerator: number, denominator: number): Rate {
  return { value: denominator === 0 ? null : numerator / denominator, numerator, denominator };
}

export function triageRates(cases: EvalCase[]): { precision: Rate; recall: Rate } {
  const judged = cases.filter((item) => item.triageRelevant !== null);
  const tp = judged.filter((item) => item.triageRelevant && item.label.relevant).length;
  const predicted = judged.filter((item) => item.triageRelevant).length;
  const actual = judged.filter((item) => item.label.relevant).length;
  return { precision: rate(tp, predicted), recall: rate(tp, actual) };
}

export function leadRates(cases: EvalCase[]): { precision: Rate; recall: Rate } {
  const tp = cases.filter((item) => item.predictedLead && item.expectedLead).length;
  const predicted = cases.filter((item) => item.predictedLead).length;
  const actual = cases.filter((item) => item.expectedLead).length;
  return { precision: rate(tp, predicted), recall: rate(tp, actual) };
}

export type ConfusionColumn = Fit | 'not_qualified';
export const CONFUSION_COLUMNS: readonly ConfusionColumn[] = [...FITS, 'not_qualified'];

/** Rows: the expected fit. Columns: the fit the model gave, or not qualified. */
export function confusionByFit(cases: EvalCase[]): Record<Fit, Record<ConfusionColumn, number>> {
  const table = Object.fromEntries(
    FITS.map((fit) => [fit, Object.fromEntries(CONFUSION_COLUMNS.map((column) => [column, 0]))]),
  ) as Record<Fit, Record<ConfusionColumn, number>>;
  for (const item of cases) table[item.label.fit][item.fit ?? 'not_qualified'] += 1;
  return table;
}

/** Wrong lead decisions, the furthest from their expected score first. */
export function worstMisses(cases: EvalCase[], limit = 10): EvalCase[] {
  return cases
    .filter((item) => item.predictedLead !== item.expectedLead)
    .map((item) => ({ item, distance: Math.abs((item.score ?? 0) - labelScore(item.label)) }))
    .sort((a, b) => b.distance - a.distance || a.item.id.localeCompare(b.item.id))
    .slice(0, limit)
    .map(({ item }) => item);
}
