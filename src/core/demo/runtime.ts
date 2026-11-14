/**
 * Demo mode: the real app and worker, with Reddit replaced by synthetic
 * fixture feeds and the AI provider replaced by the label-driven fake. No
 * key and no network are needed, and every screen has realistic content.
 */
import type { ModelResolution } from '../ai/client';
import type { Generator } from '../ai/types';
import { createFakeGenerator } from '../ai/fake';
import { createFixtureResponder } from '../ai/fake-responder';
import { systemClock, type Clock } from '../clock';
import type { GoldenLabel } from '../eval/golden';
import { goldenToRedditPost, loadGoldenSet } from '../eval/golden';
import type { RedditClient } from '../reddit/client';
import { createFixtureClient } from '../reddit/fixture';
import { createAtomSource } from '../reddit/source';
import type { RedditPost } from '../reddit/types';
import type { RuntimeOptions } from '../runtime';
import { loadScriptedLeads } from './lead-content';
import { createDemoSerpFetcher } from './serp';
import { loadSampleProducts, SAMPLE_PRODUCT_SLUGS } from './sample-products';

export const DEMO_PRODUCT_SLUG = 'acme-invoices';

/** A suggested subreddit that does not exist, so validation has something to reject. */
export const DEMO_MISSING_SUBREDDIT = 'not_a_real_demo';

/** One quiet subreddit per sample product that exists but has no posts yet. */
export const DEMO_QUIET_SUBREDDITS: Record<(typeof SAMPLE_PRODUCT_SLUGS)[number], string> = {
  'acme-invoices': 'sidehustle_demo',
  'acme-plants': 'indoorgarden_demo',
  'acme-logs': 'sysadmin_demo',
};

export interface DemoLatency {
  redditMs: number;
  modelMs: number;
}

/**
 * Pauses that give live demo scans a believable length and visible progress.
 * Far shorter than real Reddit pacing, so the demo stays quick.
 */
export const DEMO_LATENCY: DemoLatency = { redditMs: 600, modelMs: 120 };

function pause(ms: number): Promise<void> {
  return ms > 0
    ? new Promise((resolve) => {
        setTimeout(resolve, ms);
      })
    : Promise.resolve();
}

export function demoRuntimeOverrides(
  clock: Clock = systemClock,
  latency: DemoLatency = DEMO_LATENCY,
): NonNullable<RuntimeOptions['overrides']> {
  const startS = Math.floor(clock.nowMs() / 1000);
  const profiles = loadSampleProducts();
  const posts: RedditPost[] = [];
  const labels = new Map<string, GoldenLabel>();
  const suggestions: Record<string, string[]> = {};
  for (const slug of SAMPLE_PRODUCT_SLUGS) {
    const golden = loadGoldenSet(slug);
    for (const post of golden.posts) {
      // Posts appear as if written relative to when demo mode started.
      posts.push(goldenToRedditPost(post, startS));
      labels.set(post.id, post.label);
    }
    suggestions[profiles[slug].name] = [
      ...golden.subreddits,
      DEMO_QUIET_SUBREDDITS[slug],
      DEMO_MISSING_SUBREDDIT,
    ];
  }

  const fixtures = createFixtureClient({
    posts: () => posts,
    clock,
    subreddits: () => Object.values(DEMO_QUIET_SUBREDDITS),
  });
  const client: RedditClient = {
    getFeed: (path) => pause(latency.redditMs).then(() => fixtures.getFeed(path)),
  };
  const fake = createFakeGenerator(
    createFixtureResponder({
      labels,
      profiles: Object.values(profiles),
      suggestions,
      scripted: loadScriptedLeads(),
    }),
  );
  const generator: Generator = (request) => pause(latency.modelMs).then(() => fake(request));
  const serp = createDemoSerpFetcher(clock, { latencyMs: latency.redditMs });
  const resolveModel = (stage: string): ModelResolution => ({
    ok: true,
    model: { provider: 'openai_compatible', model: `demo-${stage}` },
    credentials: { apiKey: '', baseUrl: 'http://demo.invalid' },
  });
  return {
    source: createAtomSource({ client, clock }),
    generator,
    serp,
    resolveModel,
  };
}
