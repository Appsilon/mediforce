import { describe, it, expect } from 'vitest';
import { skillContentHash } from '../_helpers';
import { files } from './fixtures';

describe('skillContentHash', () => {
  it('is a sha256 hex digest', () => {
    expect(skillContentHash(files)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is independent of file order', () => {
    expect(skillContentHash([...files].reverse())).toBe(skillContentHash(files));
  });

  it('changes when a file changes', () => {
    const changed = [files[0], { ...files[1], contents: 'different' }];
    expect(skillContentHash(changed)).not.toBe(skillContentHash(files));
  });
});
