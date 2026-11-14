import { Badge } from '../../components/ui/display';
import { formatUsd } from '../../lib/format';

const STATUS: Record<string, { label: string; tone: 'brand' | 'warning' | 'danger' | 'neutral' }> =
  {
    ok: { label: 'Finished', tone: 'brand' },
    partial: { label: 'Partly finished', tone: 'warning' },
    budget_stopped: { label: 'Stopped at budget', tone: 'warning' },
    failed: { label: 'Failed', tone: 'danger' },
    running: { label: 'Running', tone: 'neutral' },
  };

export function RunStatus({ status }: { status: string }) {
  const entry = STATUS[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export const TRIGGER_LABELS: Record<string, string> = {
  schedule: 'Scheduled',
  manual: 'Scan now',
  cli: 'Command line',
  onboarding: 'First scan',
};

export function formatDuration(start: number, end: number | null): string {
  if (end === null) return '–';
  const seconds = Math.max(0, end - start);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** A run's cost; for scans billed to a subscription, what the same tokens cost on the API. */
export function RunCost({
  costUsd,
  apiEquivalentUsd,
  incomplete,
}: {
  costUsd: number;
  apiEquivalentUsd: number | null;
  incomplete: boolean;
}) {
  if (apiEquivalentUsd === null) return <>{formatUsd(costUsd, incomplete)}</>;
  const equivalent = `Subscription · API equivalent ≈ ${formatUsd(apiEquivalentUsd)}`;
  return <>{costUsd > 0 ? `${formatUsd(costUsd, incomplete)} + ${equivalent}` : equivalent}</>;
}
