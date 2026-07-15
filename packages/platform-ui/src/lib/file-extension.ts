/**
 * The lowercased extension of a file name or path — the final `.`-suffix of
 * the last path segment. Returns '' for dotfiles (`.env`), trailing-dot names,
 * and extension-less names. Single source for every extension lookup (viewer
 * selection, icon choice, content-type serving) so they cannot drift apart.
 */
export function extensionOf(fileName: string): string {
  const lastSegment = fileName.split('/').pop() ?? fileName;
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return '';
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}
