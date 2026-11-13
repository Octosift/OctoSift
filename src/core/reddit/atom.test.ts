import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { parseFeed, parseThreadFeed } from './atom';

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, '../../../fixtures/atom', name), 'utf8');

const NOW = Date.parse('2026-11-13T12:00:00Z') / 1000;

function postsOf(xml: string, now = NOW) {
  const result = parseFeed(xml, { now });
  if (result.kind !== 'posts') throw new Error(`expected posts, got ${result.kind}`);
  return result.posts;
}

describe('parseFeed', () => {
  it('reads the fields of a normal text post', () => {
    const [post] = postsOf(fixture('subreddit-feed.xml'));
    expect(post).toMatchObject({
      id: 't3_1fd0001',
      subreddit: 'freelance_demo',
      author: 'demo_user_01',
      title: 'How do you get clients to pay on time?',
      url: 'https://www.reddit.com/r/freelance_demo/comments/1fd0001/demo_post/',
      imageUrl: null,
      createdAt: Date.parse('2026-11-13T11:00:00Z') / 1000,
      archived: false,
    });
  });

  it('keeps the body as plain text with paragraph breaks and drops the footer', () => {
    const [post] = postsOf(fixture('subreddit-feed.xml'));
    expect(post?.bodyText).toBe(
      [
        'I finished three projects last month and two clients are now 30 days late.',
        'Things I tried:',
        '- Polite email reminders\n- Calling them',
        'Is there a better way to handle this without losing the client?',
      ].join('\n\n'),
    );
    expect(post?.bodyText).not.toMatch(/submitted by|\[link\]|\[comments\]/);
  });

  it('takes the image from an image post that has no body', () => {
    const post = postsOf(fixture('subreddit-feed.xml'))[1];
    expect(post?.bodyText).toBe('');
    expect(post?.imageUrl).toBe('https://i.redd.it/demo0002.png');
  });

  it('ignores external links that are not images', () => {
    const post = postsOf(fixture('subreddit-feed.xml'))[2];
    expect(post?.bodyText).toBe('');
    expect(post?.imageUrl).toBeNull();
  });

  it('finds an image linked from inside the body and records body links', () => {
    const post = postsOf(fixture('subreddit-feed.xml'))[3];
    expect(post?.imageUrl).toBe('https://preview.redd.it/demo0004.jpg?width=640&format=pjpg');
    expect(post?.bodyLinks).toEqual(['https://preview.redd.it/demo0004.jpg?width=640&format=pjpg']);
  });

  it('keeps removed and deleted bodies recognisable', () => {
    const [removed, deleted] = postsOf(fixture('removed-posts.xml'));
    expect(removed?.bodyText).toBe('[removed]');
    expect(deleted?.bodyText).toBe('[deleted]');
    expect(deleted?.author).toBe('[deleted]');
  });

  it('decodes XML and HTML entities in titles and bodies', () => {
    const [post] = postsOf(fixture('html-entities.xml'));
    expect(post?.title).toBe('Q&A: tools <and> "workflows" for invoices');
    expect(post?.bodyText).toBe('Use <tags> & “quotes”, café ☕ and 5 > 3.');
  });

  it('reports a missing subreddit for an empty "page not found" feed', () => {
    expect(parseFeed(fixture('not-found.xml'), { now: NOW })).toEqual({ kind: 'not_found' });
  });

  it('refuses documents that declare entities', () => {
    const result = parseFeed(fixture('entity-expansion.xml'), { now: NOW });
    expect(result.kind).toBe('invalid');
  });

  it('refuses input that is not an Atom feed', () => {
    expect(parseFeed('<html><body>blocked</body></html>', { now: NOW }).kind).toBe('invalid');
    expect(parseFeed('not xml at all', { now: NOW }).kind).toBe('invalid');
  });

  it('marks posts older than the archive age as archived', () => {
    const later = NOW + CONFIG.reddit.archiveAfterS + 3600 * 12;
    expect(postsOf(fixture('subreddit-feed.xml'), later)[0]?.archived).toBe(true);
  });

  it('truncates a very long body', () => {
    const paragraph = `<p>${'word '.repeat(4000)}</p>`;
    const xml = fixture('subreddit-feed.xml').replace(
      /&lt;p&gt;I finished three projects/,
      `${paragraph.replace(/</g, '&lt;').replace(/>/g, '&gt;').repeat(5)}&lt;p&gt;I finished three projects`,
    );
    const [post] = postsOf(xml);
    expect(post?.bodyText.length).toBeLessThanOrEqual(CONFIG.reddit.maxBodyChars + 20);
    expect(post?.bodyText.endsWith('[truncated]')).toBe(true);
  });

  it('skips entries that are not posts or lack required fields', () => {
    const xml = fixture('subreddit-feed.xml').replace('<id>t3_1fd0003</id>', '<id>t1_comment</id>');
    expect(postsOf(xml).map((post) => post.id)).toEqual(['t3_1fd0001', 't3_1fd0002', 't3_1fd0004']);
  });
});

describe('parseThreadFeed', () => {
  it('splits a post feed into the post and its comments', () => {
    const commentEntry = `<entry><author><name>/u/demo_user_09</name></author><category term="freelance_demo" label="r/freelance_demo"/><content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Send a reminder before the due date.&lt;/p&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt;</content><id>t1_c0001</id><link href="https://www.reddit.com/r/freelance_demo/comments/1fd0001/demo_post/c0001/" /><updated>2026-11-13T11:30:00+00:00</updated><published>2026-11-13T11:30:00+00:00</published><title>/u/demo_user_09 on How do you get clients to pay on time?</title></entry>`;
    const xml = fixture('subreddit-feed.xml')
      .replace(/<entry>.*<\/entry>/s, (all) => `${all.split('</entry>')[0] ?? ''}</entry>`)
      .replace('</feed>', `${commentEntry}</feed>`);
    const thread = parseThreadFeed(xml, { now: NOW });
    expect(thread?.post.id).toBe('t3_1fd0001');
    expect(thread?.comments).toEqual([
      {
        id: 't1_c0001',
        author: 'demo_user_09',
        bodyText: 'Send a reminder before the due date.',
        url: 'https://www.reddit.com/r/freelance_demo/comments/1fd0001/demo_post/c0001/',
        createdAt: Date.parse('2026-11-13T11:30:00Z') / 1000,
      },
    ]);
  });

  it('returns null when the feed has no post', () => {
    expect(parseThreadFeed(fixture('not-found.xml'), { now: NOW })).toBeNull();
  });
});
