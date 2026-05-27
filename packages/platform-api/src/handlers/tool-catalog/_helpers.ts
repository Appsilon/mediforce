/** Derives a deterministic catalog id from a command string: take the
 *  basename, lowercase, map non-alphanumeric runs to '-'. Inlined in the
 *  create handler — the only consumer. */
export function slugifyCommand(command: string): string {
  const basename = command.split('/').pop() ?? command;
  return basename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
