import type { NewsEntry } from './feeds';

const RELEASES_URL = 'https://api.github.com/repos/Appsilon/mediforce/releases?per_page=20';

interface GitHubRelease {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string;
  published_at: string | null;
  created_at: string;
  draft: boolean;
  prerelease: boolean;
}

export function toEntries(releases: readonly GitHubRelease[]): NewsEntry[] {
  return releases
    .filter((release) => release.draft === false && release.prerelease === false)
    .map((release) => ({
      kind: 'release' as const,
      id: `release-${release.id}`,
      title: release.name?.trim() || release.tag_name,
      url: release.html_url,
      date: release.published_at ?? release.created_at,
      tag: release.tag_name,
    }))
    .filter((entry) => entry.date !== '');
}

export async function fetchReleases(signal?: AbortSignal): Promise<NewsEntry[]> {
  const response = await fetch(RELEASES_URL, {
    headers: { accept: 'application/vnd.github+json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return toEntries(await response.json() as GitHubRelease[]);
}
