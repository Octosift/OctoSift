/** The onboarding steps in order; the account step may be skipped. */
export const STEPS = [
  { id: 'ai', label: 'AI provider' },
  { id: 'account', label: 'Reddit account' },
  { id: 'product', label: 'Product' },
  { id: 'subreddits', label: 'Subreddits' },
  { id: 'scan', label: 'First scan' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

/** The 1-based number of a step, as used in the address. */
export function stepNumber(id: StepId): number {
  return STEPS.findIndex((step) => step.id === id) + 1;
}

export function stepHref(id: StepId): string {
  return `/onboarding?step=${String(stepNumber(id))}`;
}
