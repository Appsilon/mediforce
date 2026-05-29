import { describe, it, expect } from 'vitest';
import { slugifyCommand } from '../_helpers';

describe('slugifyCommand', () => {
  it('strips path prefix and lowercases', () => {
    expect(slugifyCommand('/usr/local/bin/MyTool')).toBe('mytool');
  });

  it('replaces runs of non-alphanumerics with single dashes', () => {
    expect(slugifyCommand('foo.bar_baz')).toBe('foo-bar-baz');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugifyCommand('--tool--')).toBe('tool');
  });

  it('returns empty string when command has no alphanumerics', () => {
    expect(slugifyCommand('/')).toBe('');
    expect(slugifyCommand('---')).toBe('');
  });
});
