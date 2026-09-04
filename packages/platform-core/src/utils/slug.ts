export function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Next free name for `candidate`, suffixed `<sep>2`, `<sep>3`, … The candidate
 *  is kept verbatim, so a naming convention the caller owns (`X-Header`,
 *  `NEW_VAR`) survives. Use `uniqueSlug` when the result must be a slug. */
export function uniqueName(
  candidate: string,
  existingNames: Iterable<string>,
  separator = '-',
): string {
  const occupiedNames = new Set(existingNames);
  let uniqueName = candidate;
  let suffix = 2;
  while (occupiedNames.has(uniqueName)) {
    uniqueName = `${candidate}${separator}${String(suffix)}`;
    suffix += 1;
  }
  return uniqueName;
}

export function uniqueSlug(
  candidate: string,
  existingIds: Iterable<string>,
  currentId?: string,
): string {
  const baseId = toSlug(candidate);
  if (!baseId) return currentId ?? '';

  // The id being renamed does not occupy itself, so an unchanged name stays put.
  const occupiedIds = new Set(existingIds);
  if (currentId !== undefined) occupiedIds.delete(currentId);
  return uniqueName(baseId, occupiedIds);
}
