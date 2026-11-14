/**
 * Web addresses as people paste them: "acme.com", "www.acme.com/pricing",
 * " HTTPS://Acme.com/ ", "<https://acme.com>" or "localhost:11434/v1". Bare
 * addresses get https://, or http:// for this machine and private networks,
 * and anything that cannot be a web address is refused.
 */
import { z } from 'zod';

const PRIVATE_HOST =
  /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|\[::1\]|[^/:.]+\.local)$/i;

function hostOf(text: string): string {
  return (text.split(/[/?#]/)[0] ?? '').replace(/:\d+$/, '').toLowerCase();
}

export interface WebUrlOptions {
  /** The scheme added to a bare address; https unless it names this machine or a private network. */
  defaultScheme?: 'https' | 'http';
}

/** A full http(s) address, or null when the text cannot be one. */
export function normalizeWebUrl(raw: string, options: WebUrlOptions = {}): string | null {
  // Brackets, quotes and sentence punctuation that come along when copying from text.
  let text = raw.replace(/^[\s<"'(]+|[\s>"').,;]+$/g, '');
  if (text === '' || /\s/.test(text)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  if (!hasScheme) {
    // "mailto:x" or "javascript:x" are not web addresses; "host:8080/path" is.
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) return null;
    text = text.replace(/^\/+/, '');
    const local = PRIVATE_HOST.test(hostOf(text));
    text = `${local ? 'http' : (options.defaultScheme ?? 'https')}://${text}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    // Not parseable as an address at all.
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname;
  if (host === '' || (!host.includes('.') && host !== 'localhost' && !host.startsWith('['))) {
    return null;
  }
  url.hash = '';
  return url.toString();
}

/** A Zod schema that accepts what people paste and stores the full address. */
export function webUrl(
  message = 'Enter a web address, for example acme.com',
  options?: WebUrlOptions,
) {
  return z.string().transform((value, ctx) => {
    const normalized = normalizeWebUrl(value, options);
    if (normalized === null) {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    return normalized;
  });
}

const REDDIT_HOST = /^((www|old|new|np|m|sh|i)\.)?reddit\.com$/i;

/**
 * A link to reddit.com in its canonical form (https://www.reddit.com/...,
 * no query or fragment), from any of Reddit's hosts, with or without a
 * scheme. Null for anything else.
 */
export function normalizeRedditUrl(raw: string): string | null {
  const normalized = normalizeWebUrl(raw);
  if (normalized === null) return null;
  const url = new URL(normalized);
  if (!REDDIT_HOST.test(url.hostname)) return null;
  url.protocol = 'https:';
  url.hostname = 'www.reddit.com';
  url.port = '';
  url.search = '';
  return url.toString();
}

/** Reddit's short share links (/r/<sub>/s/<code>) hide the comment id until opened. */
export function isRedditShareLink(raw: string): boolean {
  const normalized = normalizeRedditUrl(raw);
  return normalized !== null && /^\/r\/[^/]+\/s\/[^/]+\/?$/i.test(new URL(normalized).pathname);
}
