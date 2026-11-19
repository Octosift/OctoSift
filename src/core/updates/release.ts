/**
 * Reading a GitHub release: its version number, and an optional announcement
 * written in its notes.
 *
 * An announcement is the first paragraph under a heading named
 * "Announcement" in the release notes, so it is visible on the release page
 * too. It is shown on Home as plain text with at most one https link; no
 * markdown or HTML from the notes is ever rendered.
 */
import { createHash } from 'node:crypto';
import { CONFIG } from '../config';

export type Version = readonly [number, number, number];

/** "v1.2.3" or "1.2.3"; anything else, such as a pre-release tag, is not a version. */
export function parseVersion(tag: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function formatVersion(version: Version): string {
  return version.join('.');
}

/** Whether `candidate` is a later version than `current`. Unreadable versions never are. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export interface Announcement {
  text: string;
  url: string | null;
}

function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The announcement in a release's notes, or null when there is none. */
export function parseAnnouncement(notes: string): Announcement | null {
  const lines = notes.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^#{1,6}\s+announcement\s*#*\s*$/i.test(line.trim()));
  if (start === -1) return null;
  const paragraph: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^#{1,6}\s/.test(trimmed)) break;
    if (trimmed === '') {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  if (paragraph.length === 0) return null;
  const raw = paragraph.join(' ');

  const links: string[] = [];
  const withoutLinks = raw.replace(
    // A link's address may hold one level of parentheses, as Markdown allows.
    /\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g,
    (_match, label: string, href: string) => {
      links.push(href);
      return label;
    },
  );
  const bare = /https:\/\/\S+/.exec(withoutLinks)?.[0].replace(/[).,;:!?]+$/, '');
  if (bare) links.push(bare);
  const url = links.map(httpsUrl).find((link) => link !== null) ?? null;
  const text = withoutLinks
    .replace(/<[^>]*>/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  return { text: cutAtWord(text, CONFIG.updates.maxAnnouncementChars), url };
}

/** A short, stable key for an announcement, so closing it hides only that one. */
export function announcementKey(announcement: Announcement): string {
  return createHash('sha256')
    .update(`${announcement.text}\n${announcement.url ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}
