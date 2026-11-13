/**
 * Reads a product's website to build its profile.
 *
 * Fetches the given page and up to a few same-site pages whose path or link
 * text suggests pricing, features, about, docs or FAQ. Honours robots.txt,
 * gives each page a timeout, keeps only readable text and caps its length.
 * Only public addresses are fetched, redirects included, and no response is
 * read past a fixed size.
 * Never throws: when the site cannot be read, the caller asks the user to
 * paste a description instead.
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import robotsParser from 'robots-parser';
import { BRAND } from '../brand';
import { CONFIG } from '../config';
import { privateHostReason, resolveWithDns, type ResolveHost } from './address';

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
  resolveHost?: ResolveHost;
  maxExtraPages?: number;
  maxCharsPerPage?: number;
  maxBytesPerPage?: number;
  timeoutMs?: number;
}

const USER_AGENT = `Mozilla/5.0 (compatible; ${BRAND.name}/0.1; product profile reader)`;
const ROBOTS_AGENT = BRAND.name;

type Fetched = { ok: true; url: string; html: string } | { ok: false; message: string };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function parseHttpUrl(raw: string, base?: URL): URL | null {
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    // Not parseable as a URL at all.
    return null;
  }
}

/** Reads at most `maxBytes` of a response body and stops the download there. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let received = 0;
  let chunk = await reader.read();
  while (!chunk.done) {
    const bytes = chunk.value.subarray(0, maxBytes - received);
    parts.push(decoder.decode(bytes, { stream: true }));
    received += bytes.byteLength;
    if (received >= maxBytes) {
      await reader.cancel();
      break;
    }
    chunk = await reader.read();
  }
  parts.push(decoder.decode());
  return parts.join('');
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
    resolveHost = resolveWithDns,
    maxExtraPages = CONFIG.crawl.maxExtraPages,
    maxCharsPerPage = CONFIG.crawl.maxCharsPerPage,
    maxBytesPerPage = CONFIG.crawl.maxBytesPerPage,
    timeoutMs = CONFIG.crawl.timeoutMs,
  } = options;

  const start = parseHttpUrl(rawUrl);
  if (!start) {
    return {
      ok: false,
      kind: 'invalid_url',
      message: 'Enter a full web address starting with https://',
    };
  }

  async function get(url: URL): Promise<Fetched> {
    // One deadline covers every redirect and the body.
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      let current = url;
      for (let hop = 0; hop <= CONFIG.crawl.maxRedirects; hop += 1) {
        const refused = await privateHostReason(current, resolveHost);
        if (refused) return { ok: false, message: refused };
        // Redirects are followed by hand so that every hop is checked above.
        const response = await fetchImpl(current.href, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.8' },
          signal,
          redirect: 'manual',
        });
        const location = response.headers.get('location');
        if (REDIRECT_STATUSES.has(response.status) && location) {
          await response.body?.cancel();
          const next = parseHttpUrl(location, current);
          if (!next) return { ok: false, message: 'the site redirected to an unusable address' };
          current = next;
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          return { ok: false, message: `the site answered HTTP ${response.status}` };
        }
        const type = response.headers.get('content-type') ?? '';
        if (!/text\/(html|plain)/i.test(type)) {
          await response.body?.cancel();
          return { ok: false, message: 'not a web page' };
        }
        return { ok: true, url: current.href, html: await readCapped(response, maxBytesPerPage) };
      }
      return { ok: false, message: 'the site redirected too many times' };
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
