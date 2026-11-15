import { readDraftProgress } from '../../../../lib/draft-progress';

export const dynamic = 'force-dynamic';

/** The steps of a draft being written for this lead, polled by the editor. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const progress = readDraftProgress(id) ?? { startedAt: null, steps: [], finished: true };
  // The server's clock, so the browser can time the current step on the same clock.
  return Response.json(
    { ...progress, now: Date.now() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
