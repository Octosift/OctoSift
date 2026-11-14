import { describe, expect, it } from 'vitest';
import { imageDescriptions } from '../db/schema';
import type { RedditPost } from '../reddit/types';
import { createScanHarness } from '../testing/scan-harness';
import { isRedditImage, withImage, withoutImage } from './images';
import { runScan } from './run';

const IMAGE = 'https://i.redd.it/demo_invoice_screenshot.png';

/** Gives two posts the same Reddit image and a third an image hosted elsewhere. */
function withImages(posts: RedditPost[]): RedditPost[] {
  return posts.map((post) => {
    if (post.id === 't3_inv01' || post.id === 't3_inv02') return { ...post, imageUrl: IMAGE };
    if (post.id === 't3_inv03') return { ...post, imageUrl: 'https://i.imgur.com/elsewhere.png' };
    return post;
  });
}

describe('image helpers', () => {
  it.each([
    ['https://i.redd.it/abc.png', true],
    ['https://preview.redd.it/abc.jpg?width=640', true],
    ['https://b.thumbs.redditmedia.com/abc.jpg', true],
    ['http://i.redd.it/abc.png', false],
    ['https://i.imgur.com/abc.png', false],
    ['https://redd.it.example.com/abc.png', false],
    ['not a url', false],
  ])('treats %s as a Reddit image: %s', (url, expected) => {
    expect(isRedditImage(url)).toBe(expected);
  });

  it('appends a description and can take it off again', () => {
    const body = 'My invoice looks like this, what is wrong with it?';
    const enriched = withImage(body, 'A screenshot of an invoice with no due date.');
    expect(enriched).toBe(`${body}\n\n[IMAGE] A screenshot of an invoice with no due date.`);
    expect(withoutImage(enriched)).toBe(body);
    expect(withImage(body, undefined)).toBe(body);
  });
});

describe('image descriptions in a scan', () => {
  it('are off by default', async () => {
    const harness = createScanHarness('acme-invoices', { editPosts: withImages });
    await runScan(harness.deps, { trigger: 'cli' });
    expect(harness.generator.calls.some((call) => call.task === 'image')).toBe(false);
  });

  it('describe each Reddit image once and add it to the text triage reads', async () => {
    const harness = createScanHarness('acme-invoices', { editPosts: withImages });
    harness.settings.set('ai.imageDescriptions', true);
    const report = await runScan(harness.deps, { trigger: 'cli' });
    expect(report.status).toBe('ok');
    const imageCalls = harness.generator.calls.filter((call) => call.task === 'image');
    expect(imageCalls.map((call) => call.imageUrl)).toEqual([IMAGE]);
    const triage = harness.generator.calls.find((call) => call.task === 'triage');
    expect(triage?.prompt.match(/\[IMAGE\] A photo related to the post\./g)).toHaveLength(2);
    expect(harness.db.select().from(imageDescriptions).all()).toEqual([
      expect.objectContaining({ url: IMAGE, description: 'A photo related to the post.' }),
    ]);
    // The funnel is unchanged: the description only adds context.
    expect(report.counts.leads).toBe(16);
  });

  it('stop for the rest of the scan after a failure, without failing the scan', async () => {
    const harness = createScanHarness('acme-invoices', {
      editPosts: (posts) =>
        posts.map((post, index) =>
          index < 4 ? { ...post, imageUrl: `https://i.redd.it/demo_${String(index)}.png` } : post,
        ),
      respond: (request) =>
        request.task === 'image'
          ? { fail: 'provider_error', message: 'This model does not accept images' }
          : undefined,
    });
    harness.settings.set('ai.imageDescriptions', true);
    const report = await runScan(harness.deps, { trigger: 'cli' });
    expect(harness.generator.calls.filter((call) => call.task === 'image')).toHaveLength(1);
    expect(report.status).toBe('ok');
    expect(report.counts.leads).toBe(16);
  });
});
