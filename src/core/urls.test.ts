import { describe, expect, it } from 'vitest';
import { isRedditShareLink, normalizeRedditUrl, normalizeWebUrl, webUrl } from './urls';

describe('web addresses', () => {
  it.each([
    ['acme.com', 'https://acme.com/'],
    ['www.acme.com/pricing', 'https://www.acme.com/pricing'],
    ['  HTTPS://Acme.com/  ', 'https://acme.com/'],
    ['<https://acme.com/docs#start>', 'https://acme.com/docs'],
    ['"acme.com".', 'https://acme.com/'],
    ['http://acme.com', 'http://acme.com/'],
    ['acme.com?ref=reddit', 'https://acme.com/?ref=reddit'],
    ['localhost:11434/v1', 'http://localhost:11434/v1'],
    ['192.168.1.20:1234/v1', 'http://192.168.1.20:1234/v1'],
    ['studio.local:8080', 'http://studio.local:8080/'],
  ])('reads %s', (raw, expected) => {
    expect(normalizeWebUrl(raw)).toBe(expected);
  });

  it.each(['', 'acme', 'mailto:sales', 'javascript:alert(1)', 'ftp://acme.com', 'two words.com'])(
    'refuses %j',
    (raw) => {
      expect(normalizeWebUrl(raw)).toBeNull();
    },
  );

  it('can default bare addresses to http, for proxies', () => {
    expect(normalizeWebUrl('proxy.example.net:8080', { defaultScheme: 'http' })).toBe(
      'http://proxy.example.net:8080/',
    );
  });

  it('validates and normalizes in a schema', () => {
    expect(webUrl().safeParse('acme.com')).toEqual({ success: true, data: 'https://acme.com/' });
    expect(webUrl('Bad address').safeParse('nope').error?.issues[0]?.message).toBe('Bad address');
  });
});

describe('Reddit links', () => {
  it.each([
    'https://www.reddit.com/r/freelance_demo/comments/abc123/title/def456/',
    'reddit.com/r/freelance_demo/comments/abc123/title/def456/',
    'http://old.reddit.com/r/freelance_demo/comments/abc123/title/def456/?context=3',
    'https://new.reddit.com/r/freelance_demo/comments/abc123/title/def456/#comment',
    'm.reddit.com/r/freelance_demo/comments/abc123/title/def456/',
  ])('canonicalizes %s', (raw) => {
    expect(normalizeRedditUrl(raw)).toBe(
      'https://www.reddit.com/r/freelance_demo/comments/abc123/title/def456/',
    );
  });

  it('refuses other sites and recognises share links', () => {
    expect(normalizeRedditUrl('https://notreddit.com/r/x')).toBeNull();
    expect(normalizeRedditUrl('https://reddit.com.example.net/r/x')).toBeNull();
    expect(isRedditShareLink('https://www.reddit.com/r/freelance_demo/s/AbC123xyz')).toBe(true);
    expect(isRedditShareLink('https://www.reddit.com/r/freelance_demo/comments/abc/x/def/')).toBe(
      false,
    );
  });
});
