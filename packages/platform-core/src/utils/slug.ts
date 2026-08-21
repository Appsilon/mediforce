export function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function uniqueSlug(
  candidate: string,
  existingIds: Iterable<string>,
  currentId?: string,
): string {
  const baseId = toSlug(candidate);
  if (!baseId) return currentId ?? '';

  const occupiedIds = new Set(existingIds);
  let uniqueId = baseId;
  let suffix = 2;
  while (occupiedIds.has(uniqueId) && uniqueId !== currentId) {
    uniqueId = `${baseId}-${String(suffix)}`;
    suffix += 1;
  }
  return uniqueId;
}
