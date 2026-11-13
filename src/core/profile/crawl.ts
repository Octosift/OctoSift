/**
 * Reads a product's website to build its profile.
 *
 * Fetches the given page and up to a few same-site pages whose path or link
 * text suggests pricing, features, about, docs or FAQ. Honours robots.txt,
 * gives each page a timeout, keeps only readable text and caps its length.
 * Never throws: when the site cannot be read, the caller asks the user to
 * paste a description instead.
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import robotsParser from 'robots-parser';
import { BRAND } from '../brand';
import { CONFIG } from '../config';

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export type CrawlResult =
  | { ok: true; pages: CrawledPage[] }
  | { ok: false; kind: 'invalid_url' | 'blocked_by_robots' | 'unreachable'; message: string };

export interface CrawlOptions {
  fetchImpl?: typeof fetch;
  maxExtraPages?: number;
  maxCharsPerPage?: number;
  timeoutMs?: number;
}

const USER_AGENT = `Mozilla/5.0 (compatible; ${BRAND.name}/0.1; product profile reader)`;
const ROBOTS_AGENT = BRAND.name;

type Fetched = { ok: true; url: string; html: string } | { ok: false; message: string };

function parseStartUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    // Not parseable as a URL at all.
    return null;
  }
}

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return 'the page took too long to load';
  return error instanceof Error ? error.message : 'unknown error';
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function readableText(html: string, url: string): { title: string; text: string } {
  const { document } = parseHTML(html);
  const title = collapse(document.querySelector('title')?.textContent ?? '');
  const article = new Readability(document, { charThreshold: 100 }).parse();
  const fromArticle = collapse(article?.textContent ?? '');
  if (fromArticle.length > 0)
    return { title: collapse(article?.title ?? '') || title, text: fromArticle };
  // Readability gives up on very short pages; fall back to the visible body text.
  const fallback = parseHTML(html).document;
  for (const node of fallback.querySelectorAll('script, style, noscript, nav, footer'))
    node.remove();
  return { title: title || url, text: collapse(fallback.querySelector('body')?.textContent ?? '') };
}

function candidateLinks(html: string, base: URL): URL[] {
  const { document } = parseHTML(html);
  const hints = CONFIG.crawl.pageHints;
  const seen = new Set<string>([base.href]);
  const links: URL[] = [];
  for (const anchor of document.querySelectorAll('a[href]')) {
    let target: URL;
    try {
      target = new URL(anchor.getAttribute('href') ?? '', base);
    } catch {
      // Malformed href: ignore it, like a browser would.
      continue;
    }
    target.hash = '';
    if (target.origin !== base.origin || seen.has(target.href)) continue;
    const path = target.pathname.toLowerCase();
    const label = anchor.textContent.toLowerCase();
    if (hints.some((hint) => path.includes(hint) || label.includes(hint))) {
      seen.add(target.href);
      links.push(target);
    }
  }
  return links;
}

export async function crawlProduct(
  rawUrl: string,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const {
    fetchImpl = fetch,
    maxExtraPages = CONFIG.crawl.maxExtraPages,
    maxCharsPerPage = CONFIG.crawl.maxCharsPerPage,
    timeoutMs = CONFIG.crawl.timeoutMs,
  } = options;

  const start = parseStartUrl(rawUrl);
  if (!start) {
    return {
      ok: false,
      kind: 'invalid_url',
      message: 'Enter a full web address starting with https://',
    };
  }

  async function get(url: URL): Promise<Fetched> {
    try {
      const response = await fetchImpl(url.href, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.8' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      if (!response.ok) return { ok: false, message: `the site answered HTTP ${response.status}` };
      const type = response.headers.get('content-type') ?? '';
      if (!/text\/(html|plain)/i.test(type)) return { ok: false, message: 'not a web page' };
      return { ok: true, url: response.url || url.href, html: await response.text() };
    } catch (error) {
      return { ok: false, message: describe(error) };
    }
  }

  const robotsUrl = new URL('/robots.txt', start);
  const robotsResponse = await get(robotsUrl);
  const robots = robotsParser(robotsUrl.href, robotsResponse.ok ? robotsResponse.html : '');
  const allowed = (url: URL) => robots.isAllowed(url.href, ROBOTS_AGENT) !== false;

  if (!allowed(start)) {
    return {
      ok: false,
      kind: 'blocked_by_robots',
      message: "The site's robots.txt asks crawlers not to read it. Paste a description instead.",
    };
  }

  const home = await get(start);
  if (!home.ok) {
    return {
      ok: false,
      kind: 'unreachable',
      message: `Could not read ${start.host}: ${home.message}. Paste a description of the product instead.`,
    };
  }

  const pages: CrawledPage[] = [];
  const toPage = (fetched: { url: string; html: string }): CrawledPage => {
    const { title, text } = readableText(fetched.html, fetched.url);
    return { url: fetched.url, title, text: text.slice(0, maxCharsPerPage) };
  };
  pages.push(toPage(home));

  const extra = candidateLinks(home.html, start).filter(allowed).slice(0, maxExtraPages);
  for (const link of extra) {
    const fetched = await get(link);
    if (fetched.ok) pages.push(toPage(fetched));
  }
  return { ok: true, pages: pages.filter((p, index) => index === 0 || p.text.length > 0) };
}
