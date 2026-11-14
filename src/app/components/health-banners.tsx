import { AlertTriangle, OctagonAlert } from 'lucide-react';
import Link from 'next/link';
import type { HealthIssue } from '@/core/guard/health';
import { formatClock } from '../lib/format';
import { Banner } from './ui/display';

/** Warnings about the pipeline, shown at the top of every screen. */
export function HealthBanners({ issues }: { issues: HealthIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-6 pt-4">
      {issues.map((issue) => (
        <Banner key={issue.kind} tone={issue.severity === 'error' ? 'danger' : 'warning'}>
          {issue.severity === 'error' ? (
            <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="font-medium">{issue.message}</p>
            {issue.kind === 'reddit_paused' ? (
              <p className="mt-0.5">
                Reading resumes at {formatClock(issue.resumesAt)}. If this keeps happening, set a
                proxy in{' '}
                <Link className="underline underline-offset-2" href="/settings#reddit">
                  Settings
                </Link>
                .
              </p>
            ) : null}
            {issue.kind === 'session_reauth' || issue.kind === 'source_failover' ? (
              <p className="mt-0.5">
                {issue.reason}.{' '}
                <Link
                  className="underline underline-offset-2"
                  href={
                    issue.kind === 'session_reauth' ? '/settings#reddit' : '/settings#data-source'
                  }
                >
                  {issue.kind === 'session_reauth'
                    ? 'Reconnect it or choose another data source in Settings'
                    : 'Check the data source in Settings'}
                </Link>
                .
              </p>
            ) : null}
            {issue.kind === 'ai_stopped' || issue.kind === 'budget' ? (
              <p className="mt-0.5">
                See{' '}
                <Link className="underline underline-offset-2" href="/runs">
                  Runs
                </Link>{' '}
                for details, or check{' '}
                <Link className="underline underline-offset-2" href="/settings#ai">
                  Settings
                </Link>
                .
              </p>
            ) : null}
            {'causes' in issue ? (
              <ul className="mt-1 list-disc pl-4">
                {issue.causes.map((cause) => (
                  <li key={cause}>{cause}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </Banner>
      ))}
    </div>
  );
}
