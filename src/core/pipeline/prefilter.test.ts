import { describe, expect, it } from 'vitest';
import type { RedditPost } from '../reddit/types';
import { detectLanguage, prefilter, type PrefilterContext } from './prefilter';

const NOW = 1_800_000_000;
const HOUR = 3600;

function post(overrides: Partial<RedditPost> = {}): RedditPost {
  return {
    id: 't3_p1',
    subreddit: 'freelance_demo',
    author: 'demo_user_01',
    title: 'How do I get clients to pay on time?',
    bodyText: 'Two of my clients are thirty days late again. What do you do to get paid?',
    bodyLinks: [],
    url: 'https://www.reddit.com/r/freelance_demo/comments/p1/x/',
    imageUrl: null,
    createdAt: NOW - 2 * HOUR,
    archived: false,
    ...overrides,
  };
}

const context: PrefilterContext = {
  now: NOW,
  maxPostAgeHours: 48,
  ownUsername: 'demo_founder',
  blocklist: { subreddits: ['spam_demo'], terms: ['crypto giveaway'] },
  languages: ['en'],
  brandTerms: ['Acme Invoices', 'acme-invoices.example'],
  detectLanguage: () => 'en',
};

describe('prefilter', () => {
  it('passes an ordinary recent post', () => {
    expect(prefilter(post(), context)).toEqual({ verdict: 'pass', brandMention: false });
  });

  it.each([
    [{ removed: true }, 'removed'],
    [{ locked: true }, 'locked'],
    [{ nsfw: true }, 'nsfw'],
  ] as const)('skips posts the source marks %o', (flags, reason) => {
    expect(prefilter(post(flags), context)).toMatchObject({ verdict: 'skip', reason });
  });

  it('skips posts older than the maximum age', () => {
    expect(prefilter(post({ createdAt: NOW - 49 * HOUR }), context)).toMatchObject({
      verdict: 'skip',
      reason: 'too_old',
    });
  });

  it.each(['[removed]', '[deleted]'])('skips posts whose body is %s', (body) => {
    expect(prefilter(post({ bodyText: body }), context)).toMatchObject({
      verdict: 'skip',
      reason: 'removed',
    });
  });

  it('skips posts with neither a body nor an image', () => {
    expect(prefilter(post({ bodyText: '' }), context)).toMatchObject({ reason: 'empty' });
  });

  it('keeps image posts without a body', () => {
    const imagePost = post({ bodyText: '', imageUrl: 'https://i.redd.it/demo.png' });
    expect(prefilter(imagePost, context).verdict).toBe('pass');
  });

  it('skips posts on user profiles', () => {
    expect(prefilter(post({ subreddit: 'u_demo_user_01' }), context)).toMatchObject({
      reason: 'profile_post',
    });
  });

  it("skips the founder's own posts, ignoring case", () => {
    expect(prefilter(post({ author: 'Demo_Founder' }), context)).toMatchObject({
      reason: 'own_post',
    });
  });

  it.each(['AutoModerator', 'RemindMeBot', 'demo_bot'])('skips posts by the bot %s', (author) => {
    expect(prefilter(post({ author }), context)).toMatchObject({ reason: 'bot_author' });
  });

  it('skips blocklisted subreddits', () => {
    expect(prefilter(post({ subreddit: 'spam_demo' }), context)).toMatchObject({
      reason: 'blocked_subreddit',
    });
  });

  it('skips posts containing a blocklisted term, ignoring case', () => {
    expect(prefilter(post({ title: 'Huge CRYPTO GIVEAWAY today' }), context)).toMatchObject({
      reason: 'blocked_term',
    });
  });

  it('skips posts with two or more links to unknown sites', () => {
    const links = ['https://cheap-pills.example/a', 'https://seo-links.example/b'];
    expect(prefilter(post({ bodyLinks: links }), context)).toMatchObject({ reason: 'spam_links' });
  });

  it('allows links to common hosts and a single unknown link', () => {
    const links = [
      'https://github.com/demo/repo',
      'https://www.youtube.com/watch?v=x',
      'https://i.redd.it/a.png',
      'https://one-site.example/x',
    ];
    expect(prefilter(post({ bodyLinks: links }), context).verdict).toBe('pass');
  });

  it('skips posts in languages the product does not support', () => {
    const spanish = { ...context, detectLanguage: () => 'es' };
    expect(prefilter(post(), spanish)).toMatchObject({ reason: 'language' });
  });

  it('keeps posts whose language cannot be determined', () => {
    const unsure = { ...context, detectLanguage: () => null };
    expect(prefilter(post(), unsure).verdict).toBe('pass');
  });

  it('tags posts that mention the product by name or domain', () => {
    expect(prefilter(post({ bodyText: 'Has anyone tried acme invoices?' }), context)).toEqual({
      verdict: 'pass',
      brandMention: true,
    });
    expect(prefilter(post({ bodyText: 'Saw acme-invoices.example on a forum.' }), context)).toEqual(
      { verdict: 'pass', brandMention: true },
    );
  });

  it('keeps brand mentions that other topical rules would skip', () => {
    const mention = post({
      bodyText: 'Acme Invoices or something else? https://a.example/1 https://b.example/2',
      bodyLinks: ['https://a.example/1', 'https://b.example/2'],
    });
    expect(prefilter(mention, context)).toEqual({ verdict: 'pass', brandMention: true });
  });

  it('still skips removed posts that mention the product', () => {
    expect(
      prefilter(post({ title: 'Acme Invoices?', bodyText: '[removed]' }), context),
    ).toMatchObject({
      reason: 'removed',
    });
  });
});

describe('detectLanguage', () => {
  it('recognises English and Spanish text', () => {
    expect(
      detectLanguage(
        'How do you get clients to pay on time? I tried polite emails and phone calls but nothing works.',
      ),
    ).toBe('en');
    expect(
      detectLanguage(
        '¿Cómo consigo que mis clientes paguen a tiempo? Probé correos amables y llamadas, pero nada funciona.',
      ),
    ).toBe('es');
  });

  it('returns null for text too short to judge', () => {
    expect(detectLanguage('help pls')).toBeNull();
  });
});
