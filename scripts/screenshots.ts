/**
 * Takes the README screenshots from a running demo, so they can be redone
 * after a design change or a rename. Start the demo first (`pnpm demo`), then:
 *
 *   pnpm screenshots                      # against http://127.0.0.1:3005
 *   SHOTS_URL=http://127.0.0.1:4000 pnpm screenshots
 *
 * Only the demo's synthetic data ever appears in the images.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const base = process.env.SHOTS_URL ?? 'http://127.0.0.1:3005';
const out = resolve(process.cwd(), 'docs/images');

interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Shot {
  name: string;
  path: string;
  dark?: boolean;
  /** Waits for the page to be ready and arranges it; may return the area to keep. */
  prepare?: (page: Page) => Promise<Clip | undefined>;
}

const inboxReady = async (page: Page) => {
  await page.getByRole('textbox', { name: 'Reply draft' }).waitFor();
  return undefined;
};

const SHOTS: Shot[] = [
  { name: 'inbox', path: '/inbox', prepare: inboxReady },
  { name: 'inbox-dark', path: '/inbox', dark: true, prepare: inboxReady },
  { name: 'home', path: '/' },
  {
    name: 'run-reasons',
    path: '/runs',
    prepare: async (page) => {
      await page.getByRole('link', { name: 'See every post and reason' }).click();
      await page.waitForURL(/\/runs\/[^/?]+/);
      await page.goto(`${page.url()}?stage=qualify`, { waitUntil: 'networkidle' });
      return undefined;
    },
  },
  {
    name: 'presets',
    path: '/settings',
    prepare: async (page) => {
      const card = page.locator('#ai');
      // The demo picks its own models, which adds a note real setups do not show.
      await page.getByText('You picked the models yourself').evaluateAll((notes) => {
        for (const note of notes) note.remove();
      });
      await card.evaluate((element) => {
        element.scrollIntoView({ block: 'start' });
      });
      const top = await card.boundingBox();
      const end = await page.getByRole('button', { name: 'Use this preset' }).boundingBox();
      if (!top || !end) return undefined;
      const pad = 24;
      return {
        x: top.x - pad,
        y: Math.max(0, top.y - pad),
        width: top.width + pad * 2,
        height: end.y + end.height + 20 - Math.max(0, top.y - pad),
      };
    },
  },
];

async function main() {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: shot.dark ? 'dark' : 'light',
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      await page.goto(new URL(shot.path, base).toString(), { waitUntil: 'networkidle' });
      const clip = shot.prepare ? await shot.prepare(page) : undefined;
      await page.waitForTimeout(300);
      const file = resolve(out, `${shot.name}.png`);
      await page.screenshot({ path: file, clip });
      process.stdout.write(`${file}\n`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
