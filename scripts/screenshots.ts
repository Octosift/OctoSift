/**
 * Takes the README images from a running demo, so they can be redone after a
 * design change or a rename. Start the demo first (`pnpm demo`), then:
 *
 *   pnpm screenshots                      # against http://127.0.0.1:3005
 *   SHOTS_URL=http://127.0.0.1:4000 pnpm screenshots
 *
 * Besides the screenshots it frames the inbox for the README header and, when
 * ffmpeg is installed, records a short tour as docs/images/demo.gif.
 * Only the demo's synthetic data ever appears in the images.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

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
  { name: 'product', path: '/product' },
  {
    name: 'subreddits',
    path: '/subreddits',
    prepare: async (page) => {
      const table = await page.locator('table').first().boundingBox();
      if (!table) return undefined;
      return { x: 0, y: 0, width: 1440, height: Math.min(900, table.y + table.height + 40) };
    },
  },
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

/** Puts a screenshot in a window frame on the brand background, for the README header. */
async function frame(browser: Browser, source: string, target: string, dark: boolean) {
  const image = readFileSync(resolve(out, source)).toString('base64');
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
  });
  const bg = dark
    ? 'radial-gradient(120% 90% at 50% 0%, #134e4a 0%, #0b1513 55%, #070b0a 100%)'
    : 'radial-gradient(120% 90% at 50% 0%, #ccfbf1 0%, #ecfdf5 45%, #f8faf9 100%)';
  const bar = dark ? '#1c2321' : '#eef1f0';
  const edge = dark ? 'rgba(255,255,255,.08)' : 'rgba(15,23,42,.08)';
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${bg};
    width:1600px;height:1000px;display:flex;align-items:center;justify-content:center">
    <div style="width:1440px;border-radius:14px;overflow:hidden;border:1px solid ${edge};
      box-shadow:0 40px 90px -20px rgba(2,44,34,${dark ? '.7' : '.28'}),0 12px 30px -10px rgba(0,0,0,.18)">
      <div style="height:34px;background:${bar};display:flex;align-items:center;gap:8px;padding:0 14px">
        <i style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></i>
        <i style="width:12px;height:12px;border-radius:50%;background:#febc2e"></i>
        <i style="width:12px;height:12px;border-radius:50%;background:#28c840"></i>
      </div>
      <img style="display:block;width:1440px" src="data:image/png;base64,${image}" />
    </div></body></html>`);
  await page.screenshot({ path: resolve(out, target) });
  await page.close();
  process.stdout.write(`${resolve(out, target)}\n`);
}

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Records a short tour of the demo and turns it into a GIF. */
async function tour(browser: Browser) {
  const videos = resolve(out, '.video');
  rmSync(videos, { recursive: true, force: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videos, size: { width: 1440, height: 900 } },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const pause = (ms: number) => page.waitForTimeout(ms);
  await page.goto(new URL('/', base).toString(), { waitUntil: 'networkidle' });
  await pause(1800);
  await page
    .getByRole('link', { name: /^Inbox/ })
    .first()
    .click();
  await page.getByRole('textbox', { name: 'Reply draft' }).waitFor();
  await pause(2200);
  for (const key of ['j', 'j', 'j', 'k']) {
    await page.keyboard.press(key);
    await pause(1500);
  }
  await page.getByRole('combobox', { name: 'Reply length' }).selectOption('short');
  await pause(900);
  await page
    .getByRole('textbox', { name: 'Instruction for the next draft' })
    .pressSequentially('mention the free plan first', { delay: 45 });
  await pause(1400);
  await page.goto(new URL('/runs', base).toString(), { waitUntil: 'networkidle' });
  await pause(1200);
  await page.getByRole('link', { name: 'See every post and reason' }).click();
  await page.waitForURL(/\/runs\/[^/?]+/);
  await page.goto(`${page.url()}?stage=qualify`, { waitUntil: 'networkidle' });
  await pause(2600);
  await context.close();
  const [video] = readdirSync(videos);
  if (!video) return;
  const gif = resolve(out, 'demo.gif');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    resolve(videos, video),
    '-vf',
    'fps=8,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    gif,
  ]);
  rmSync(videos, { recursive: true, force: true });
  process.stdout.write(`${gif}\n`);
}

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
    await frame(browser, 'inbox.png', 'hero.png', false);
    await frame(browser, 'inbox-dark.png', 'hero-dark.png', true);
    if (hasFfmpeg()) await tour(browser);
    else process.stdout.write('ffmpeg not found, skipping demo.gif\n');
  } finally {
    await browser.close();
  }
}

await main();
