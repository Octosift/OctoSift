import { exportData } from '@/core/db/queries/data';
import { getRuntime } from '../../lib/runtime';

export const dynamic = 'force-dynamic';

/** Downloads everything collected so far as JSON. Secrets are never included. */
export function GET() {
  const runtime = getRuntime();
  const body = JSON.stringify(
    { exportedAt: new Date().toISOString(), ...exportData(runtime.db) },
    null,
    2,
  );
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="export-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
