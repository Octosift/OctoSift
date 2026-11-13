/** Builds inbox URLs from the current search params plus changes. */
export function inboxHref(
  current: URLSearchParams | Record<string, string | undefined>,
  changes: Record<string, string | number | undefined | null>,
): string {
  const params = new URLSearchParams(
    current instanceof URLSearchParams
      ? current
      : Object.entries(current).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
  );
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === null || value === '') params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `/inbox?${query}` : '/inbox';
}
