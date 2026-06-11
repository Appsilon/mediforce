import { ValidationError } from '../../errors';

const GITHUB_HOST = 'github.com';

export function buildRawUrl(repo: string, ref: string, path: string): string {
  let url: URL;
  try {
    url = new URL(repo);
  } catch {
    throw new ValidationError(`Invalid repo URL: ${repo}`);
  }
  if (url.hostname !== GITHUB_HOST) {
    throw new ValidationError(`Only GitHub repos are supported (got: ${url.hostname})`);
  }
  // Expect exactly /owner/repo — reject sub-paths like /org/repo/tree/main
  const segments = url.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw new ValidationError(
      `Repo URL must be https://github.com/owner/repo (got: ${repo})`,
    );
  }
  return `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/${ref}/${path}`;
}
