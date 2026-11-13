/**
 * Turns the HTML inside a Reddit feed entry into plain text and links.
 *
 * Reddit wraps the post body in `<div class="md">`; everything outside it is
 * a footer ("submitted by", [link], [comments]) that is never part of the
 * post. Text keeps paragraph breaks and simple list markers so the AI stages
 * see the structure the author wrote.
 */
import { parseHTML } from 'linkedom';

// Private-use characters mark breaks while rendering; they never occur in feeds.
const PARAGRAPH = '\uE001';
const LINE = '\uE000';
const PARAGRAPH_TAGS = new Set([
  'p',
  'div',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'table',
  'hr',
]);
const IMAGE_HOSTS = new Set(['i.redd.it', 'preview.redd.it', 'i.imgur.com']);
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i;

interface DomNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<DomNode>;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function render(node: DomNode): string {
  if (node.nodeType === TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== ELEMENT_NODE) return '';
  const tag = node.nodeName.toLowerCase();
  if (tag === 'pre') return `${PARAGRAPH}${node.textContent ?? ''}${PARAGRAPH}`;
  if (tag === 'br') return LINE;
  const inner = Array.from(node.childNodes, render).join('');
  if (tag === 'li') return `${LINE}- ${inner.trim()}${LINE}`;
  if (tag === 'tr') return `${LINE}${inner}${LINE}`;
  if (tag === 'td' || tag === 'th') return `${inner} `;
  if (PARAGRAPH_TAGS.has(tag)) return `${PARAGRAPH}${inner}${PARAGRAPH}`;
  return inner;
}

function normalise(rendered: string): string {
  return rendered
    .replace(/[ \t]+(?=[\uE000\uE001])/g, '')
    .replace(/(?<=[\uE000\uE001])[ \t]+/g, '')
    .replace(/[\uE000\uE001]+/g, (run) => (run.includes(PARAGRAPH) ? '\n\n' : '\n'))
    .trim();
}

export interface EntryHtml {
  /** Plain text of the post or comment body; empty when there is none. */
  bodyText: string;
  /** Every link inside the body. */
  bodyLinks: string[];
  /** Target of the footer's "[link]" anchor, for link and image posts. */
  footerLink: string | null;
}

export function readEntryHtml(html: string): EntryHtml {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const body = document.querySelector('div.md');
  const footerAnchor = Array.from(document.querySelectorAll('a')).find(
    (anchor) => anchor.textContent.trim() === '[link]' && !body?.contains(anchor),
  );
  return {
    bodyText: body ? normalise(render(body)) : '',
    bodyLinks: body
      ? Array.from(
          body.querySelectorAll('a[href]'),
          (anchor) => anchor.getAttribute('href') ?? '',
        ).filter((href) => href.length > 0)
      : [],
    footerLink: footerAnchor?.getAttribute('href') ?? null,
  };
}

export function isImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return IMAGE_HOSTS.has(parsed.hostname) || IMAGE_EXTENSION.test(parsed.pathname);
  } catch {
    // Not an absolute URL (relative links appear in some bodies): not an image.
    return false;
  }
}
