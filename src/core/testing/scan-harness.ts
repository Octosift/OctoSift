/**
 * A complete scan setup on fixtures: an in-memory database with one sample
 * product, its golden posts served as Atom feeds, and the fake generator
 * answering from the golden labels.
 */
import type { ModelResolution } from '../ai/client';
import { createFakeGenerator, type FakeGenerator, type FakeReply } from '../ai/fake';
import { createFixtureResponder } from '../ai/fake-responder';
import type { GenerateRequest } from '../ai/types';
import { seededRandom } from '../clock';
import { openMemoryDatabase, type Db } from '../db/client';
import { insertProduct, watchSubreddit } from '../db/queries/products';
import { goldenToRedditPost, loadGoldenSet, type GoldenSet } from '../eval/golden';
import { silentLogger } from '../log';
import { createFixtureClient } from '../reddit/fixture';
import { createAtomSource } from '../reddit/source';
import type { RedditSource } from '../reddit/types';
import type { ScanDeps } from '../pipeline/run';
import { createSettingsStore, type SettingsStore } from '../settings/store';
import { createFakeClock, type FakeClock } from './fake-clock';
import { loadSampleProducts, type SampleProductSlug } from './sample-products';

export interface ScanHarness {
  db: Db;
  settings: SettingsStore;
  clock: FakeClock;
  golden: GoldenSet;
  productId: string;
  generator: FakeGenerator;
  deps: ScanDeps;
}

export interface HarnessOptions {
  /** Overrides the label-based answers for some calls. */
  respond?: (request: GenerateRequest) => FakeReply | undefined;
  resolveModel?: ScanDeps['resolveModel'];
  source?: RedditSource;
}

export const HARNESS_NOW_MS = Date.parse('2026-11-13T12:00:00Z');

export function createScanHarness(
  slug: SampleProductSlug,
  options: HarnessOptions = {},
): ScanHarness {
  const db = openMemoryDatabase();
  const settings = createSettingsStore(db);
  const clock = createFakeClock(HARNESS_NOW_MS);
  const nowS = Math.floor(HARNESS_NOW_MS / 1000);
  const golden = loadGoldenSet(slug);
  const profiles = loadSampleProducts();
  const productId = `product-${slug}`;
  insertProduct(db, { id: productId, profile: profiles[slug], now: nowS });
  for (const name of golden.subreddits) watchSubreddit(db, productId, name, nowS);

  const posts = golden.posts.map((post) => goldenToRedditPost(post, nowS));
  const client = createFixtureClient({ posts: () => posts, clock });
  const labels = new Map(golden.posts.map((post) => [post.id, post.label]));
  const fixtureResponder = createFixtureResponder({ labels, profiles: Object.values(profiles) });
  const generator = createFakeGenerator(
    (request) => options.respond?.(request) ?? fixtureResponder(request),
  );
  const resolveModel = (stage: string): ModelResolution => ({
    ok: true,
    model: { provider: 'openai_compatible', model: `fake-${stage}` },
    credentials: { apiKey: '', baseUrl: 'http://localhost:0' },
  });

  const deps: ScanDeps = {
    db,
    source: options.source ?? createAtomSource({ client, clock }),
    generator,
    resolveModel: options.resolveModel ?? resolveModel,
    settings,
    clock,
    random: seededRandom(42),
    log: silentLogger(),
    redact: (text) => text,
  };
  return { db, settings, clock, golden, productId, generator, deps };
}
