/** Derives a deterministic catalog id from a command string: take the
 *  basename, lowercase, map non-alphanumeric runs to '-'. */
export function slugifyCommand(command: string): string {
  const basename = command.split('/').pop() ?? command;
  return slugify(basename);
}

/** Derives a deterministic catalog id from an HTTP server URL: its host,
 *  slugged the same way. `https://api.github.com/mcp` → `api-github-com`. */
export function slugifyUrl(url: string): string {
  try {
    return slugify(new URL(url).hostname);
  } catch {
    return '';
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
