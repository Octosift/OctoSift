import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { announcementKey, isNewer, parseAnnouncement, parseVersion } from './release';

describe('parseVersion', () => {
  it('reads tags with or without a leading v', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion(' 0.10.0 ')).toEqual([0, 10, 0]);
  });

  it('rejects pre-release tags and other text', () => {
    expect(parseVersion('v1.2.3-beta.1')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
  });
});

describe('isNewer', () => {
  it('compares each part as a number', () => {
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('v1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.1', '0.1.0')).toBe(true);
  });

  it('is false for the same or an older version, and for unreadable ones', () => {
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.0.9', '0.1.0')).toBe(false);
    expect(isNewer('nightly', '0.1.0')).toBe(false);
  });
});

describe('parseAnnouncement', () => {
  it('takes the first paragraph under an Announcement heading, with its link', () => {
    const notes = [
      '## What changed',
      '- Faster scans',
      '',
      '## Announcement',
      '',
      'The **browser extension** is out. [Read more](https://example.com/extension)',
      'It works with every plan.',
      '',
      'A second paragraph that is not shown.',
      '## Fixes',
      '- Something',
    ].join('\n');
    expect(parseAnnouncement(notes)).toEqual({
      text: 'The browser extension is out. Read more It works with every plan.',
      url: 'https://example.com/extension',
    });
  });

  it('finds a bare https link and drops trailing punctuation', () => {
    expect(parseAnnouncement('### announcement\nSee https://example.com/news.')).toEqual({
      text: 'See https://example.com/news.',
      url: 'https://example.com/news',
    });
  });

  it('never keeps a link that is not https, or any HTML', () => {
    const result = parseAnnouncement(
      '# Announcement\n<img src=x onerror=alert(1)>Click [here](javascript:alert(1)) or http://example.com',
    );
    expect(result).toEqual({ text: 'Click here or http://example.com', url: null });
  });

  it('is null without the heading, or with an empty section', () => {
    expect(parseAnnouncement('## Changes\n- One')).toBeNull();
    expect(parseAnnouncement('## Announcement\n\n## Changes\n- One')).toBeNull();
    expect(parseAnnouncement('')).toBeNull();
  });

  it('cuts long text at a word', () => {
    const long = `## Announcement\n${'word '.repeat(200)}`;
    const result = parseAnnouncement(long);
    expect(result?.text.length).toBeLessThanOrEqual(CONFIG.updates.maxAnnouncementChars);
    expect(result?.text.endsWith('word…')).toBe(true);
  });
});

describe('announcementKey', () => {
  it('changes when the text or link changes', () => {
    const a = announcementKey({ text: 'Hello', url: null });
    expect(a).toHaveLength(16);
    expect(announcementKey({ text: 'Hello', url: null })).toBe(a);
    expect(announcementKey({ text: 'Hello!', url: null })).not.toBe(a);
    expect(announcementKey({ text: 'Hello', url: 'https://example.com/' })).not.toBe(a);
  });
});
