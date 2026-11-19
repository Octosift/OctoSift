/**
 * Asks GitHub's public API for the latest published release of the project.
 *
 * This is the app's only request to GitHub. It carries no identifier and no
 * data about the user: a User-Agent with the app's name and version, which
 * GitHub requires, and nothing else. Drafts and pre-releases are never
 * returned by this endpoint.
 */
import { z } from 'zod';
import { BRAND } from '../brand';
import { CONFIG } from '../config';

const releaseSchema = z.object({
  tag_name: z.string().min(1),
  html_url: z.string().startsWith('https://github.com/'),
  published_at: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
});

export interface LatestRelease {
  /** The tag, for example "v0.2.0". */
  tag: string;
  url: string;
  publishedAt: string | null;
  notes: string;
}

export type ReleaseResult =
  { ok: true; release: LatestRelease | null } | { ok: false; message: string };

export function latestReleaseUrl(repository: string = BRAND.repository): string {
  return `https://api.github.com/repos/${repository}/releases/latest`;
}

export async function fetchLatestRelease(
  options: { repository?: string; fetchImpl?: typeof fetch } = {},
): Promise<ReleaseResult> {
  const { fetchImpl = fetch } = options;
  let response: Response;
  try {
    response = await fetchImpl(latestReleaseUrl(options.repository), {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${BRAND.name}/${BRAND.version}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(CONFIG.updates.timeoutMs),
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Network error' };
  }
  // No release has been published yet.
  if (response.status === 404) return { ok: true, release: null };
  if (response.status === 403 || response.status === 429) {
    return { ok: false, message: 'GitHub is limiting requests from this network for now' };
  }
  if (!response.ok) return { ok: false, message: `GitHub answered HTTP ${response.status}` };

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, message: 'GitHub sent a response that is not JSON' };
  }
  const parsed = releaseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: 'GitHub sent an unexpected release format' };
  return {
    ok: true,
    release: {
      tag: parsed.data.tag_name,
      url: parsed.data.html_url,
      publishedAt: parsed.data.published_at ?? null,
      notes: parsed.data.body ?? '',
    },
  };
}
