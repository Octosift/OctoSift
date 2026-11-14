/** Formatting helpers shared by server and client components. */

/** "now", "5m", "3h", "2d", "3w", or a date for anything older than about a year. */
export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return 'now';
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52) return `${weeks}w`;
  return `${Math.floor(days / 365)}y`;
}

export function formatAgo(epochSeconds: number, nowSeconds: number): string {
  const age = formatAge(nowSeconds - epochSeconds);
  return age === 'now' ? 'just now' : `${age} ago`;
}

export function formatUsd(amount: number, incomplete = false): string {
  const digits = amount > 0 && amount < 0.01 ? 4 : 2;
  return `$${amount.toFixed(digits)}${incomplete ? '+' : ''}`;
}

/** A charge exactly as an API reported it: up to six decimals, trailing zeros trimmed. */
export function formatExactUsd(amount: number): string {
  const [whole = '0', fraction = ''] = amount.toFixed(6).split('.');
  return `$${whole}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`;
}

/** Local time of day for an epoch-seconds timestamp, for "resumes at" messages. */
export function formatClock(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
