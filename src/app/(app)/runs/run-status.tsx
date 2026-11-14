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

/** A run's cost; when it paid for Reddit data, the AI and data parts are shown apart. */
export function RunCost({
  costUsd,
  dataCostUsd,
  incomplete,
  inline = false,
}: {
  costUsd: number;
  dataCostUsd: number;
  incomplete: boolean;
  /** One line, for headers. */
  inline?: boolean;
}) {
  if (dataCostUsd <= 0) return <>{formatUsd(costUsd, incomplete)}</>;
  const ai = formatUsd(Math.max(0, costUsd - dataCostUsd), incomplete);
  if (inline) {
    return (
      <>
        {formatUsd(costUsd, incomplete)} (AI {ai} + data {formatUsd(dataCostUsd)})
      </>
    );
  }
  return (
    <span title="AI and Reddit data together">
      {formatUsd(costUsd, incomplete)}
      <span className="block text-xs text-muted-foreground">
        AI {ai} · data {formatUsd(dataCostUsd)}
      </span>
    </span>
  );
}
