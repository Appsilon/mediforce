import { createHash } from 'node:crypto';
import type { SkillFile } from '@mediforce/platform-core';

/** sha256 over a Skill's files, independent of the order they were sent in. */
export function skillContentHash(files: ReadonlyArray<SkillFile>): string {
  const canonical = [...files]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((file) => [file.path, file.contents]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
