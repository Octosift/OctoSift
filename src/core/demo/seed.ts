/**
 * Fills a fresh database with a realistic demo: the Acme Invoices sample
 * product, a few days of scan history through the real pipeline (with the
 * fake AI provider), and leads in every state a founder would see.
 */
import { eq, inArray } from 'drizzle-orm';
import type { ModelResolution } from '../ai/client';
import { createFakeGenerator } from '../ai/fake';
import { createFixtureResponder } from '../ai/fake-responder';
import { frozenClock, seededRandom } from '../clock';
import type { Db } from '../db/client';
import { insertProduct, watchSubreddit } from '../db/queries/products';
import { feedback, leads, posts, runs } from '../db/schema';
import { goldenToRedditPost, loadGoldenSet, type GoldenPost } from '../eval/golden';
import { newId } from '../ids';
import { silentLogger } from '../log';
import { runScan } from '../pipeline/run';
import { createFixtureClient } from '../reddit/fixture';
import { createAtomSource } from '../reddit/source';
import type { RedditSource } from '../reddit/types';
import { createSettingsStore } from '../settings/store';
import { loadScriptedLeads } from './lead-content';
import { loadSampleProducts } from './sample-products';

export const DEMO_PRODUCT_ID = 'demo-acme-invoices';
const HOUR = 3600;
const DAY = 24 * HOUR;

export interface SeedSummary {
  leads: number;
  runs: number;
}

function configureSettings(db: Db): void {
  const settings = createSettingsStore(db);
  settings.set('onboarding.completed', true);
  settings.set('ai.compatibleBaseUrl', 'http://demo.invalid');
  settings.set('ai.stages', {
    triage: { provider: 'openai_compatible', model: 'demo-triage' },
    qualify: { provider: 'openai_compatible', model: 'demo-qualify' },
    draft: { provider: 'openai_compatible', model: 'demo-draft' },
    review: { provider: 'openai_compatible', model: 'demo-review' },
  });
  settings.set('ai.prices', {
    'demo-triage': { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
    'demo-qualify': { inputPerMillionUsd: 1, outputPerMillionUsd: 4 },
    'demo-draft': { inputPerMillionUsd: 1, outputPerMillionUsd: 4 },
    'demo-review': { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
  });
  settings.set('reddit.ownUsername', 'demo_founder');
}

export async function seedDemo(db: Db, nowMs: number): Promise<SeedSummary> {
  configureSettings(db);
  const now = Math.floor(nowMs / 1000);
  const profiles = loadSampleProducts();
  const golden = loadGoldenSet('acme-invoices');
  const history = loadGoldenSet('acme-invoices-history', `${process.cwd()}/fixtures/demo`);
  insertProduct(db, {
    id: DEMO_PRODUCT_ID,
    profile: profiles['acme-invoices'],
    now: now - 6 * DAY,
  });
  for (const name of golden.subreddits) watchSubreddit(db, DEMO_PRODUCT_ID, name, now - 6 * DAY);

  const labels = new Map([...golden.posts, ...history.posts].map((post) => [post.id, post.label]));
  const generator = createFakeGenerator(
    createFixtureResponder({
      labels,
      profiles: Object.values(profiles),
      scripted: loadScriptedLeads(),
    }),
  );
  const resolveModel = (stage: string): ModelResolution => ({
    ok: true,
    model: { provider: 'openai_compatible', model: `demo-${stage}` },
    credentials: { apiKey: '', baseUrl: 'http://demo.invalid' },
  });
  const settings = createSettingsStore(db);

  /**
   * Runs one scan at a moment in the past. The clock is frozen there, so the
   * run is given the duration a real scan would take: about a minute per
   * Reddit request plus the model calls.
   */
  async function scanAt(
    atS: number,
    batch: GoldenPost[] | 'blocked',
    durationS: number,
  ): Promise<void> {
    const clock = frozenClock(atS * 1000);
    const source: RedditSource =
      batch === 'blocked'
        ? {
            fetchNewPosts: () =>
              Promise.resolve({
                ok: false,
                kind: 'blocked',
                retryAfterS: 600,
                message: 'HTTP 429',
              }),
          }
        : createAtomSource({
            client: createFixtureClient({
              posts: () => batch.map((post) => goldenToRedditPost(post, atS)),
              clock,
            }),
            clock,
          });
    const report = await runScan(
      {
        db,
        source,
        generator,
        resolveModel,
        settings,
        clock,
        random: seededRandom(atS),
        log: silentLogger(),
        redact: (text) => text,
      },
      { trigger: 'schedule', ignoreSchedule: true },
    );
    db.update(runs)
      .set({ finishedAt: atS + durationS })
      .where(eq(runs.id, report.runId))
      .run();
  }

  // Each older scan reads a dozen leads among posts that are not (t3_dem25 onwards).
  const number = (post: GoldenPost) => Number(post.id.replace('t3_dem', ''));
  const firstScan = history.posts.filter(
    (post) => number(post) <= 12 || (number(post) >= 25 && number(post) <= 38),
  );
  const secondScan = history.posts.filter((post) => !firstScan.includes(post));
  await scanAt(now - 5 * DAY, firstScan, 134);
  await scanAt(now - 3 * DAY, 'blocked', 41);
  await scanAt(now - 2 * DAY, secondScan, 157);
  // Recent enough that the demo worker does not rescan the moment it starts.
  await scanAt(now - 25 * 60, golden.posts, 192);

  moveLeadsThroughTheirLife(db, now);
  return {
    leads: db.select().from(leads).all().length,
    runs: 4,
  };
}

/** Gives older leads the states a founder would have left them in. */
function moveLeadsThroughTheirLife(db: Db, now: number): void {
  const byPost = (postIds: string[]) =>
    db
      .select({ id: leads.id, postId: leads.postId, mentionOk: leads.mentionOk })
      .from(leads)
      .innerJoin(posts, eq(posts.id, leads.postId))
      .where(inArray(leads.postId, postIds))
      .all();
  const set = (postIds: string[], changes: Partial<typeof leads.$inferInsert>) => {
    for (const lead of byPost(postIds)) {
      db.update(leads).set(changes).where(eq(leads.id, lead.id)).run();
    }
  };
  const replied = (postId: string, daysAgo: number, mentioned: boolean) => {
    set([postId], {
      status: 'replied',
      repliedAt: now - daysAgo * DAY,
      repliedWithMention: mentioned,
      updatedAt: now - daysAgo * DAY,
    });
  };

  replied('t3_dem01', 4.8, true);
  replied('t3_dem02', 4.7, false);
  replied('t3_dem03', 4.5, false);
  replied('t3_dem05', 4.2, false);
  replied('t3_dem07', 4.0, true);
  replied('t3_dem09', 3.9, false);
  replied('t3_dem14', 1.8, false);
  replied('t3_dem18', 1.6, false);
  set(['t3_dem06', 't3_dem10'], {
    status: 'dismissed',
    dismissReason: 'Already solved in the comments',
    updatedAt: now - 4 * DAY,
  });
  set(['t3_dem16'], {
    status: 'dismissed',
    dismissReason: 'Not our audience',
    updatedAt: now - 1.5 * DAY,
  });
  set(['t3_dem15', 't3_dem20'], {
    status: 'snoozed',
    snoozedUntil: now + DAY,
    updatedAt: now - DAY,
  });

  const feedbackRows = [
    {
      postId: 't3_dem01',
      signal: 'good' as const,
      note: 'Exactly the kind of freelancer we serve',
    },
    { postId: 't3_dem07', signal: 'good' as const, note: '' },
    {
      postId: 't3_dem16',
      signal: 'bad' as const,
      note: 'We do not serve agencies with large teams',
    },
    { postId: 't3_dem10', signal: 'bad' as const, note: 'Skip posts about deposits and contracts' },
  ];
  for (const row of feedbackRows) {
    const [lead] = byPost([row.postId]);
    if (!lead) continue;
    db.insert(feedback)
      .values({
        id: newId(),
        productId: DEMO_PRODUCT_ID,
        leadId: lead.id,
        signal: row.signal,
        note: row.note,
        createdAt: now - 3 * DAY,
      })
      .run();
  }
}
