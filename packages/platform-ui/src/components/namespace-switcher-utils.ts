// Top-level list routes that exist identically in every workspace. Switching
// namespace while on one of these preserves the section; anything else (the
// workspace root, or a resource-detail route whose id won't exist in the target
// workspace) lands on the target workspace root.
const STABLE_SECTIONS: readonly string[] = ['/runs', '/agents', '/tools', '/tasks', '/monitoring'];

export function buildNamespaceSwitchHref(
  pathname: string,
  currentHandle: string,
  targetHandle: string,
): string {
  const prefix = currentHandle !== '' ? `/${currentHandle}` : '';
  const sectionPath = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
  const normalizedSection = sectionPath === '' ? '' : sectionPath.replace(/\/$/, '');
  if (STABLE_SECTIONS.includes(normalizedSection)) {
    return `/${targetHandle}${normalizedSection}`;
  }
  return `/${targetHandle}`;
}
