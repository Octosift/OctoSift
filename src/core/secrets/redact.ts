/**
 * Removes secrets from text before it is logged or shown to the user.
 *
 * Two layers: values the app knows are secret (every key it has stored or
 * loaded), and patterns that look like credentials even if the app has never
 * seen them, such as a key echoed back in a provider's error message.
 */

const REPLACEMENT = '[redacted]';
/** Remembered values shorter than this would redact ordinary words. */
const MIN_REMEMBERED_LENGTH = 6;

const KEY_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9+/=._-]{16,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** user:password@ in URLs; the scheme and host are kept so the message stays useful. */
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
/** key=..., token=... and similar query or form parameters. */
const SECRET_PARAMS = /\b(api[_-]?key|key|token|access_token|secret|password)=([^\s&"']{8,})/gi;

export interface Redactor {
  remember(value: string): void;
  redact(text: string): string;
  redactValue(value: unknown): unknown;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createRedactor(): Redactor {
  const remembered = new Set<string>();

  function redact(text: string): string {
    let output = text;
    // Longest first, so a value that contains another is removed whole.
    const known = [...remembered].sort((a, b) => b.length - a.length);
    for (const value of known) {
      output = output.replace(new RegExp(escapeRegExp(value), 'g'), REPLACEMENT);
    }
    for (const pattern of KEY_PATTERNS) output = output.replace(pattern, REPLACEMENT);
    output = output.replace(URL_CREDENTIALS, `$1${REPLACEMENT}@`);
    output = output.replace(SECRET_PARAMS, `$1=${REPLACEMENT}`);
    return output;
  }

  function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
    if (typeof value === 'string') return redact(value);
    if (value instanceof Error) {
      return { name: value.name, message: redact(value.message) };
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) return '[circular]';
      seen.add(value);
      return value.map((item) => redactValue(item, seen));
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[circular]';
      seen.add(value);
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, redactValue(item, seen)]),
      );
    }
    return value;
  }

  return {
    remember(value) {
      if (value.length >= MIN_REMEMBERED_LENGTH) remembered.add(value);
    },
    redact,
    redactValue: (value) => redactValue(value),
  };
}
