import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { runScan } from '../../pipeline/run';
import { createScanHarness, type ScanHarness } from '../../testing/scan-harness';
import { leads } from '../schema';
import { countByTab, inboxSubreddits, leadDetail, listLeads, wakeSnoozedLeads } from './inbox';

let harness: ScanHarness;
let now: number;

beforeAll(async () => {
  harness = createScanHarness('acme-invoices');
  await runScan(harness.deps, { trigger: 'cli' });
  now = Math.floor(harness.clock.nowMs() / 1000);
});

const page = () => ({ limit: 50, offset: 0, now });

describe('inbox queries', () => {
  it('counts leads per tab', () => {
    expect(countByTab(harness.db)).toEqual({
      todo: 16,
      replied: 0,
      snoozed: 0,
      dismissed: 0,
      brand: 1,
    });
  });

  it('shows every lead that needs action in To do, drafted or not, best first', () => {
    const { rows, total } = listLeads(harness.db, { tab: 'todo' }, page());
    expect(total).toBe(16);
    const scores = rows.map((row) => row.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(rows.map((row) => row.status))).toEqual(new Set(['new', 'drafted']));
    expect(rows[0]).toMatchObject({ productName: 'Acme Invoices', status: 'drafted' });
  });

  it('filters by subreddit, intent, minimum score and post age', () => {
    const bySub = listLeads(harness.db, { tab: 'todo', subreddit: 'smallbiz_demo' }, page());
    expect(bySub.rows.every((row) => row.subreddit === 'smallbiz_demo')).toBe(true);
    const byIntent = listLeads(harness.db, { tab: 'todo', intent: 'venting' }, page());
    expect(byIntent.rows.map((row) => row.intent)).toEqual(['venting', 'venting', 'venting']);
    expect(listLeads(harness.db, { tab: 'todo', minScore: 90 }, page()).total).toBe(6);
    expect(listLeads(harness.db, { tab: 'todo', maxAgeHours: 2 }, page()).total).toBe(8);
  });

  it('pages through results', () => {
    const first = listLeads(harness.db, { tab: 'todo' }, { limit: 4, offset: 0, now });
    const second = listLeads(harness.db, { tab: 'todo' }, { limit: 4, offset: 4, now });
    expect(first.rows).toHaveLength(4);
    expect(second.rows.map((row) => row.id)).not.toContain(first.rows[0]?.id);
    expect(second.total).toBe(16);
  });

  it('keeps brand mentions in their own tab', () => {
    const { rows } = listLeads(harness.db, { tab: 'brand' }, page());
    expect(rows.map((row) => row.kind)).toEqual(['brand_mention']);
  });

  it('lists the subreddits that produced leads', () => {
    expect(inboxSubreddits(harness.db)).toEqual(['freelance_demo', 'smallbiz_demo']);
  });

  it('returns a lead with its post and latest drafts', () => {
    const [row] = listLeads(harness.db, { tab: 'todo' }, page()).rows;
    const detail = leadDetail(harness.db, row?.id ?? '');
    expect(detail?.post.title).toBe(row?.title);
    expect(detail?.reply?.kind).toBe('reply');
    expect(leadDetail(harness.db, 'missing')).toBeNull();
  });

  it('brings snoozed leads back when their time comes', () => {
    const [row] = listLeads(harness.db, { tab: 'todo' }, page()).rows;
    const id = row?.id ?? '';
    harness.db
      .update(leads)
      .set({ status: 'snoozed', snoozedUntil: now + 60 })
      .where(eq(leads.id, id))
      .run();
    expect(wakeSnoozedLeads(harness.db, now)).toBe(0);
    expect(wakeSnoozedLeads(harness.db, now + 61)).toBe(1);
    expect(harness.db.select().from(leads).where(eq(leads.id, id)).get()?.status).toBe('new');
  });
});
