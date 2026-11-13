import 'server-only';
import { countByTab, wakeSnoozedLeads } from '@/core/db/queries/inbox';
import { listProducts } from '@/core/db/queries/products';
import { recentRuns } from '@/core/db/queries/runs';
import { loadHealth } from '@/core/guard/health';
import { CONFIG } from '@/core/config';
import { pendingScanRequest, scanInProgress } from '@/core/scan-lock';
import { getRuntime, nowSeconds } from '../runtime';

export interface ShellData {
  products: { id: string; name: string }[];
  /** Leads in the To do tab: new and drafted opportunities. */
  toDo: number;
  health: ReturnType<typeof loadHealth>;
  lastRun: { id: string; startedAt: number; status: string } | null;
  scan: 'idle' | 'requested' | 'running';
  demo: boolean;
  now: number;
}

export function loadShell(): ShellData {
  const { db, clock, env } = getRuntime();
  const now = nowSeconds();
  wakeSnoozedLeads(db, now);
  const last = recentRuns(db, 1)[0];
  const running = scanInProgress(db, clock.nowMs(), CONFIG.schedule.lockStaleAfterMs);
  return {
    products: listProducts(db).map((product) => ({ id: product.id, name: product.name })),
    toDo: countByTab(db).todo,
    health: loadHealth(db, now),
    lastRun: last ? { id: last.id, startedAt: last.startedAt, status: last.status } : null,
    scan: running ? 'running' : pendingScanRequest(db) ? 'requested' : 'idle',
    demo: env.DEMO_MODE,
    now,
  };
}
