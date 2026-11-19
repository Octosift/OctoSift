import { describe, expect, it } from 'vitest';
import { BRAND } from '../brand';
import { fetchLatestRelease, latestReleaseUrl } from './github';

function respond(status: number, body: unknown) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, init });
    return Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    );
  };
  return { fetchImpl, requests };
}

const RELEASE = {
  tag_name: 'v0.2.0',
  html_url: 'https://github.com/Octosift/OctoSift/releases/tag/v0.2.0',
  published_at: '2026-12-01T10:00:00Z',
  body: '## Changes\n- Faster',
};

describe('fetchLatestRelease', () => {
  it('asks the project repository and sends only a name and version', async () => {
    const { fetchImpl, requests } = respond(200, RELEASE);
    const result = await fetchLatestRelease({ fetchImpl });
    expect(result).toEqual({
      ok: true,
      release: {
        tag: 'v0.2.0',
        url: RELEASE.html_url,
        publishedAt: RELEASE.published_at,
        notes: RELEASE.body,
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(latestReleaseUrl());
    expect(requests[0]?.url).toBe(
      `https://api.github.com/repos/${BRAND.repository}/releases/latest`,
    );
    expect(requests[0]?.init?.method ?? 'GET').toBe('GET');
    expect(requests[0]?.init?.body).toBeUndefined();
    expect(requests[0]?.init?.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'User-Agent': `${BRAND.name}/${BRAND.version}`,
      'X-GitHub-Api-Version': '2022-11-28',
    });
  });

  it('treats a missing release as no release rather than an error', async () => {
    const { fetchImpl } = respond(404, { message: 'Not Found' });
    expect(await fetchLatestRelease({ fetchImpl })).toEqual({ ok: true, release: null });
  });

  it('reports rate limits, server errors and bad answers as failures', async () => {
    expect(await fetchLatestRelease(respond(403, {}))).toMatchObject({ ok: false });
    expect(await fetchLatestRelease(respond(503, {}))).toEqual({
      ok: false,
      message: 'GitHub answered HTTP 503',
    });
    expect(await fetchLatestRelease(respond(200, 'not json'))).toMatchObject({ ok: false });
    expect(
      await fetchLatestRelease(respond(200, { ...RELEASE, html_url: 'https://evil.example/x' })),
    ).toMatchObject({ ok: false });
  });

  it('reports a network error as a failure', async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new Error('offline'));
    expect(await fetchLatestRelease({ fetchImpl })).toEqual({ ok: false, message: 'offline' });
  });

  it('accepts a release without notes', async () => {
    const { fetchImpl } = respond(200, { ...RELEASE, body: null, published_at: null });
    expect(await fetchLatestRelease({ fetchImpl })).toMatchObject({
      ok: true,
      release: { notes: '', publishedAt: null },
    });
  });
});
