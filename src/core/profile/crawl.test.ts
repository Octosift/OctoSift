import { describe, expect, it } from 'vitest';
import { crawlProduct, type CrawlOptions } from './crawl';

interface FakePage {
  status?: number;
  body: string;
  contentType?: string;
  fail?: 'timeout' | 'network';
}

const ORIGIN = 'https://acme-invoices.example';

function page(title: string, main: string, links: string[] = []): string {
  const anchors = links.map((link) => `<a href="${link}">${link}</a>`).join(' ');
  return `<!doctype html><html><head><title>${title}</title></head><body>
    <nav>${anchors}</nav>
    <article><h1>${title}</h1><p>${main}</p><p>${main}</p><p>${main}</p></article>
    <footer>Footer text</footer></body></html>`;
}

function setup(site: Record<string, FakePage>, overrides: Partial<CrawlOptions> = {}) {
  const requested: string[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const entry = site[url];
    if (!entry) return Promise.resolve(new Response('not found', { status: 404 }));
    if (entry.fail === 'timeout') {
      return Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
    }
    if (entry.fail === 'network') return Promise.reject(new TypeError('fetch failed'));
    return Promise.resolve(
      new Response(entry.body, {
        status: entry.status ?? 200,
        headers: { 'content-type': entry.contentType ?? 'text/html; charset=utf-8' },
      }),
    );
  };
  const options: CrawlOptions = {
    fetchImpl,
    maxExtraPages: 5,
    maxCharsPerPage: 6_000,
    timeoutMs: 10_000,
    ...overrides,
  };
  return { requested, run: (url = ORIGIN) => crawlProduct(url, options) };
}

const MAIN = 'Acme Invoices helps freelancers send invoices and get paid on time.';

describe('crawlProduct', () => {
  it('reads the home page and same-site pages that look like pricing, features, about, docs or FAQ', async () => {
    const { run, requested } = setup({
      [`${ORIGIN}/`]: {
        body: page('Home', MAIN, [
          '/pricing',
          '/features',
          '/about',
          '/docs/start',
          '/faq',
          '/blog/post-1',
          '/careers',
        ]),
      },
      [`${ORIGIN}/pricing`]: { body: page('Pricing', 'Free for three clients.') },
      [`${ORIGIN}/features`]: { body: page('Features', 'Reminders and payment links.') },
      [`${ORIGIN}/about`]: { body: page('About', 'Built by a former freelancer.') },
      [`${ORIGIN}/docs/start`]: { body: page('Docs', 'Create your first invoice.') },
      [`${ORIGIN}/faq`]: { body: page('FAQ', 'Does it do taxes? No.') },
    });
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((p) => new URL(p.url).pathname)).toEqual([
      '/',
      '/pricing',
      '/features',
      '/about',
      '/docs/start',
      '/faq',
    ]);
    expect(result.pages[0]?.text).toContain('get paid on time');
    expect(requested).not.toContain(`${ORIGIN}/blog/post-1`);
  });

  it('selects pages by link text as well as path', async () => {
    const home = `<html><body><p>${MAIN}</p><a href="/p/1">Plans and pricing</a><a href="/p/2">Our blog</a></body></html>`;
    const { run } = setup({
      [`${ORIGIN}/`]: { body: home },
      [`${ORIGIN}/p/1`]: { body: page('Plans', 'Monthly plan.') },
    });
    const result = await run();
    expect(result.ok && result.pages.map((p) => new URL(p.url).pathname)).toEqual(['/', '/p/1']);
  });

  it('never follows links to other sites', async () => {
    const { run, requested } = setup({
      [`${ORIGIN}/`]: { body: page('Home', MAIN, ['https://other.example/pricing']) },
    });
    await run();
    expect(requested.some((url) => url.startsWith('https://other.example'))).toBe(false);
  });

  it('stops after the configured number of extra pages', async () => {
    const { run } = setup(
      {
        [`${ORIGIN}/`]: { body: page('Home', MAIN, ['/pricing', '/features', '/about']) },
        [`${ORIGIN}/pricing`]: { body: page('Pricing', 'p') },
        [`${ORIGIN}/features`]: { body: page('Features', 'f') },
      },
      { maxExtraPages: 2 },
    );
    const result = await run();
    expect(result.ok && result.pages).toHaveLength(3);
  });

  it('skips pages that robots.txt disallows', async () => {
    const { run, requested } = setup({
      [`${ORIGIN}/robots.txt`]: {
        body: 'User-agent: *\nDisallow: /pricing\n',
        contentType: 'text/plain',
      },
      [`${ORIGIN}/`]: { body: page('Home', MAIN, ['/pricing', '/faq']) },
      [`${ORIGIN}/faq`]: { body: page('FAQ', 'Answers.') },
    });
    const result = await run();
    expect(result.ok && result.pages.map((p) => new URL(p.url).pathname)).toEqual(['/', '/faq']);
    expect(requested).not.toContain(`${ORIGIN}/pricing`);
  });

  it('reports a site that disallows reading its home page', async () => {
    const { run } = setup({
      [`${ORIGIN}/robots.txt`]: { body: 'User-agent: *\nDisallow: /\n', contentType: 'text/plain' },
    });
    expect(await run()).toMatchObject({ ok: false, kind: 'blocked_by_robots' });
  });

  it('caps the text taken from each page', async () => {
    const { run } = setup(
      { [`${ORIGIN}/`]: { body: page('Home', 'word '.repeat(5_000)) } },
      { maxCharsPerPage: 500 },
    );
    const result = await run();
    expect(result.ok && result.pages[0]?.text.length).toBeLessThanOrEqual(500);
  });

  it('skips a page that times out and keeps the rest', async () => {
    const { run } = setup({
      [`${ORIGIN}/`]: { body: page('Home', MAIN, ['/pricing', '/faq']) },
      [`${ORIGIN}/pricing`]: { body: '', fail: 'timeout' },
      [`${ORIGIN}/faq`]: { body: page('FAQ', 'Answers.') },
    });
    const result = await run();
    expect(result.ok && result.pages.map((p) => new URL(p.url).pathname)).toEqual(['/', '/faq']);
  });

  it('asks for a description when the home page cannot be read', async () => {
    const { run } = setup({ [`${ORIGIN}/`]: { body: '', fail: 'timeout' } });
    const result = await run();
    expect(result).toMatchObject({ ok: false, kind: 'unreachable' });
    expect(result.ok ? '' : result.message).toMatch(/paste a description/i);
  });

  it('rejects anything that is not an http or https URL', async () => {
    const { run, requested } = setup({});
    expect(await run('file:///etc/passwd')).toMatchObject({ ok: false, kind: 'invalid_url' });
    expect(await run('not a url')).toMatchObject({ ok: false, kind: 'invalid_url' });
    expect(requested).toEqual([]);
  });

  it('ignores pages that are not HTML', async () => {
    const { run } = setup({
      [`${ORIGIN}/`]: { body: page('Home', MAIN, ['/pricing']) },
      [`${ORIGIN}/pricing`]: { body: '%PDF-1.4', contentType: 'application/pdf' },
    });
    const result = await run();
    expect(result.ok && result.pages).toHaveLength(1);
  });
});
