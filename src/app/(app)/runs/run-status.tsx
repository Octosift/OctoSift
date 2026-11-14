import { Badge } from '../../components/ui/display';

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
