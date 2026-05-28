/** Converts a GitHub repo URL + ref to the raw.githubusercontent.com base URL.
 *  Returns null for non-GitHub URLs or malformed input. */
export function githubRawBase(repoUrl: string, ref: string): string | null {
  let url: URL;
  try { url = new URL(repoUrl); } catch { return null; }
  if (url.hostname !== 'github.com') return null;
  const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
  if (parts.length < 2) return null;
  return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${ref}`;
}
